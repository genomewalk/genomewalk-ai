import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { yieldToLoop } from "../async/schedule.ts";
import { AppError } from "../app-error.ts";
import { classifyRuntimeFailure } from "../diagnostics/runtime-failure.ts";
import { getReadingContext } from "../diagnostics/reading.ts";
import { streamBgzfChunks } from "../io/bgzf.ts";
import {
  decodePublicJson,
  fetchPublic,
  readPublicBytes,
  readPublicChunks,
} from "../io/fetch-public.ts";
import type { Fetcher, Progress, Status } from "../io/types.ts";
import type { CatalogueMetadata } from "./types.ts";

export interface Catalogue extends CatalogueMetadata {
  /** Metadata transfer, not the separately streamed catalogue body. */
  bytes: number;
  seconds: number;
  /** Data rows only. Callers must exhaust this iterator before publishing results. */
  rows(signal?: AbortSignal, onProgress?: Progress): AsyncGenerator<string>;
}

const integer = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");
const counts = (value: unknown, total: number) =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.values(value).every(integer) &&
  Object.values(value).reduce((sum: number, count: number) => sum + count, 0) === total;

function validateMetadata(value: CatalogueMetadata, build: string) {
  const details = {
    resource: "catalogue-index" as const,
    publicFile: `/ref/${build}/catalog.meta.json`,
  };
  if (
    !value ||
    value.schema !== 1 ||
    !integer(value.source?.size) ||
    !value.source.size ||
    !/^[a-f0-9]{64}$/.test(value.source?.sha256 || "") ||
    !integer(value.n) ||
    !value.n ||
    typeof value.header !== "string" ||
    !value.header.startsWith("#chrom\tpos\tref\talt\t") ||
    !strings(value.chromosomes) ||
    !value.chromosomes.length ||
    value.chromosomes.some((chromosome) => !/^[A-Za-z0-9_.-]+$/.test(chromosome)) ||
    new Set(value.chromosomes).size !== value.chromosomes.length ||
    !strings(value.sample) ||
    value.sample.length > 6 ||
    !strings(value.examples) ||
    value.examples.length > 3 ||
    !counts(value.byClass, value.n) ||
    !counts(value.byStars, value.n)
  )
    throw new AppError("REFERENCE_INDEX_INVALID", "The catalogue metadata is invalid.", details);
  if (value.build !== build) throw new AppError("REFERENCE_BUILD_MISMATCH", undefined, details);
}

/** Load small public counts/examples only; there is no catalogue-wide key or row map. */
export async function loadCatalogue(
  build: string,
  signal?: AbortSignal,
  onStatus?: Status,
  fetcher: Fetcher = fetch,
): Promise<Catalogue> {
  if (build !== "GRCh37" && build !== "GRCh38")
    throw new AppError("REFERENCE_BUILD_MISMATCH", "A supported reference build is required.");
  signal?.throwIfAborted();
  onStatus?.(`Loading the ${build} catalogue summary…`);
  const started = performance.now();
  const response = await fetchPublic(
    `/ref/${build}/catalog.meta.json`,
    "catalogue-index",
    { signal: signal ?? null },
    fetcher,
  );
  const bytes = await readPublicBytes(response, "catalogue-index");
  const metadata = decodePublicJson<CatalogueMetadata>(bytes, "catalogue-index");
  validateMetadata(metadata, build);
  signal?.throwIfAborted();
  return {
    ...metadata,
    bytes: bytes.length,
    seconds: (performance.now() - started) / 1000,
    rows: (signal, onProgress) => streamCatalogueRows(metadata, signal, onProgress, fetcher),
  };
}

/** One GET, backpressure, incremental hashing and complete rows across block/UTF-8 boundaries. */
export async function* streamCatalogueRows(
  metadata: CatalogueMetadata,
  signal?: AbortSignal,
  onProgress?: Progress,
  fetcher: Fetcher = fetch,
): AsyncGenerator<string> {
  const publicFile = `/ref/${metadata.build}/catalog.tsv.gz`;
  const details = { resource: "catalogue-entries" as const, publicFile };
  const invalid = (message: string) => new AppError("REFERENCE_INTEGRITY_FAILED", message, details);
  const response = await fetchPublic(
    `${publicFile}?v=${metadata.source.sha256}`,
    "catalogue-entries",
    { signal: signal ?? null },
    fetcher,
  );
  const encoding = response.headers.get("content-encoding");
  if (response.status !== 200 || (encoding && encoding.toLowerCase() !== "identity")) {
    await response.body?.cancel().catch(() => {});
    throw invalid("The catalogue host must return the complete, unchanged compressed file.");
  }
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || +length !== metadata.source.size)) {
    await response.body?.cancel().catch(() => {});
    throw invalid("The catalogue size does not match its metadata. Reload and try again.");
  }
  let received = 0;
  const digest = sha256.create();
  async function* chunks() {
    for await (const bytes of readPublicChunks(response, "catalogue-entries", signal)) {
      received += bytes.length;
      if (received > metadata.source.size) throw invalid("The catalogue is larger than expected.");
      digest.update(bytes);
      yield bytes;
      onProgress?.(received / metadata.source.size);
    }
    if (received !== metadata.source.size) throw invalid("The catalogue download is incomplete.");
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let carry = "";
  let lastPaint = performance.now();
  let header = false;
  let rows = 0;
  const ranks = new Map(metadata.chromosomes.map((chromosome, index) => [chromosome, index]));
  let previousRank = -1;
  let previousPosition = 0;
  function record(raw: string): string | null {
    const line = raw.replace(/\r$/, "");
    if (!line) return null;
    if (!header) {
      if (line !== metadata.header)
        throw invalid("The catalogue header does not match its metadata.");
      header = true;
      return null;
    }
    const [chromosome, position] = line.split("\t", 2);
    const rank = ranks.get(chromosome!);
    if (
      rank === undefined ||
      !/^[1-9]\d*$/.test(position!) ||
      !Number.isSafeInteger(+position!) ||
      rank < previousRank ||
      (rank === previousRank && +position! < previousPosition)
    )
      throw invalid("The catalogue records are not in the published chromosome/position order.");
    previousRank = rank;
    previousPosition = +position!;
    rows++;
    return line;
  }
  try {
    for await (const block of streamBgzfChunks(chunks(), signal)) {
      const lines = (carry + decoder.decode(block.data, { stream: true })).split("\n");
      carry = lines.pop()!;
      for (const line of lines) {
        signal?.throwIfAborted();
        const row = record(line);
        if (row !== null) yield row;
      }
      if (performance.now() - lastPaint > 30) {
        await yieldToLoop();
        signal?.throwIfAborted();
        lastPaint = performance.now();
      }
    }
    carry += decoder.decode();
    if (carry) {
      const row = record(carry);
      if (row !== null) yield row;
    }
    signal?.throwIfAborted();
    if (!header || rows !== metadata.n || bytesToHex(digest.digest()) !== metadata.source.sha256)
      throw invalid("The catalogue does not match its metadata. Reload and try again.");
    onProgress?.(1);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    if (error instanceof AppError && error.details.resource) throw error;
    throw new AppError(
      classifyRuntimeFailure(error) ?? "REFERENCE_DECODE_FAILED",
      "The public catalogue could not be read completely. Reload and try again.",
      {
        ...details,
        ...getReadingContext(error),
        ...(error instanceof AppError ? error.details : {}),
      },
    );
  } finally {
    digest.destroy();
  }
}
