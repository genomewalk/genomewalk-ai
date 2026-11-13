import { gunzipSync } from "fflate";
import { AppError, type ErrorDetails, type ErrorResource } from "../app-error.ts";
import { classifyRuntimeFailure } from "../diagnostics/runtime-failure.ts";
import { safePublicFile } from "../public-file.ts";
import type { Fetcher } from "./types.ts";

const responseFiles = new WeakMap<Response, string>();

function capacityCode(error: unknown) {
  return error instanceof AppError &&
    (error.code === "BROWSER_ALLOCATION_FAILED" || error.code === "BROWSER_DATA_LIMIT")
    ? error.code
    : classifyRuntimeFailure(error);
}

function downloadFailure(error: unknown, details: ErrorDetails): never {
  // Cancellation is control flow, not a failed download. Timeouts remain actionable.
  if (error instanceof Error && error.name === "AbortError") throw error;
  throw new AppError(
    capacityCode(error) ??
      (error instanceof Error && error.name === "TimeoutError"
        ? "NETWORK_TIMEOUT"
        : "NETWORK_FAILED"),
    undefined,
    details,
  );
}

/** Retain only a reviewed public path; full request URLs, bodies and headers are never retained. */
export async function fetchPublic(
  input: string | URL | Request,
  resource: ErrorResource,
  init?: RequestInit,
  fetcher: Fetcher = fetch,
): Promise<Response> {
  const publicFile = safePublicFile(input, resource);
  const details = { resource, ...(publicFile ? { publicFile } : {}) };
  let response: Response;
  try {
    init?.signal?.throwIfAborted();
    response = await fetcher(input, init);
  } catch (error) {
    // Some fetch implementations replace the abort reason with a generic network error.
    if (init?.signal?.aborted) {
      const reason = init.signal.reason;
      if (!(reason instanceof Error && reason.name === "TimeoutError")) throw reason;
      downloadFailure(reason, details);
    }
    downloadFailure(error, details);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new AppError("HTTP_ERROR", undefined, { ...details, httpStatus: response.status });
  }
  if (publicFile) responseFiles.set(response, publicFile);
  return response;
}

export async function readPublicBytes(response: Response, resource: ErrorResource) {
  try {
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    const publicFile = safePublicFile(responseFiles.get(response), resource);
    downloadFailure(error, {
      resource,
      httpStatus: response.status,
      ...(publicFile ? { publicFile } : {}),
    });
  }
}

/** Pull only as the consumer advances, and release the network body on abort or early return. */
export async function* readPublicChunks(
  response: Response,
  resource: ErrorResource,
  signal?: AbortSignal,
) {
  const publicFile = safePublicFile(responseFiles.get(response), resource);
  const details = {
    resource,
    httpStatus: response.status,
    ...(publicFile ? { publicFile } : {}),
  };
  if (!response.body) throw new AppError("NETWORK_FAILED", undefined, details);
  const reader = response.body.getReader();
  const cancel = () => void reader.cancel(signal?.reason).catch(() => {});
  signal?.addEventListener("abort", cancel, { once: true });
  let complete = false;
  try {
    while (true) {
      signal?.throwIfAborted();
      const next = await reader.read();
      signal?.throwIfAborted();
      if (next.done) {
        complete = true;
        return;
      }
      yield next.value;
    }
  } catch (error) {
    if (signal?.aborted) {
      const reason = signal.reason;
      if (!(reason instanceof Error && reason.name === "TimeoutError")) throw reason;
      downloadFailure(reason, details);
    }
    downloadFailure(error, details);
  } finally {
    signal?.removeEventListener("abort", cancel);
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Only public reference files use this decoder; private file parsers retain their own errors. */
export function decodePublicJson<T>(bytes: Uint8Array, resource: ErrorResource): T {
  try {
    const json = bytes[0] === 31 && bytes[1] === 139 ? gunzipSync(bytes) : bytes;
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json));
  } catch (error) {
    throw new AppError(capacityCode(error) ?? "REFERENCE_DECODE_FAILED", undefined, {
      resource,
    });
  }
}
