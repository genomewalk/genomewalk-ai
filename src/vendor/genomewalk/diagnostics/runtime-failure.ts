import { AppError } from "../app-error.ts";

type RuntimeFailureCode = "BROWSER_ALLOCATION_FAILED" | "BROWSER_DATA_LIMIT";

const messages = {
  BROWSER_ALLOCATION_FAILED:
    "Your browser could not allocate enough memory to continue. Close other tabs and try again, or use another browser or device.",
  BROWSER_DATA_LIMIT:
    "Your browser reached its size limit for a text or binary value. Try another browser or device, or choose a smaller supported file.",
  FILE_READ_FAILED:
    "Your browser could not read this file. Check that it is available on this device, then choose it again.",
} as const;

/** Recognize specific engine failures, never infer a capacity problem from file size. */
export function classifyRuntimeFailure(error: unknown): RuntimeFailureCode | null {
  // Firefox can throw this preallocated string when allocating an Error is unsafe.
  if (error === "out of memory") return "BROWSER_ALLOCATION_FAILED";
  if (!(error instanceof Error) || error instanceof AppError) return null;
  if (
    (error.name === "RangeError" &&
      ["Array buffer allocation failed", "Out of memory"].includes(error.message)) ||
    (error.name === "InternalError" && error.message === "out of memory")
  )
    return "BROWSER_ALLOCATION_FAILED";
  if (
    (error.name === "RangeError" && error.message === "Invalid string length") ||
    (error.name === "InternalError" && error.message === "allocation size overflow")
  )
    return "BROWSER_DATA_LIMIT";
  // Invalid array lengths and call-stack overflow also cause RangeError, without
  // establishing a memory or input-size problem. Leave those diagnoses intact.
  return null;
}

/** Optional safe recovery text for recognized native failures at UI catch boundaries. */
export function runtimeFailureMessage(error: unknown): string | null {
  if (error instanceof AppError)
    return Object.hasOwn(messages, error.code)
      ? messages[error.code as keyof typeof messages]
      : null;
  const code = classifyRuntimeFailure(error);
  if (code) return messages[code];
  if (
    error instanceof Error &&
    (error.name === "NotReadableError" || error.name === "SecurityError")
  )
    return messages.FILE_READ_FAILED;
  return null;
}
