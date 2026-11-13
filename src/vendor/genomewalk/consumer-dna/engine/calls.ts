import type { CallSource, ConsumerCall } from "../types.ts";
import type { Progress } from "../../io/types.ts";
export const streamCalls = (
  source: CallSource,
  each: (call: ConsumerCall) => void,
  onProgress?: Progress | null,
  signal?: AbortSignal,
) => source.readCalls(each, onProgress, signal);
export const callSignature = (call: ConsumerCall) =>
  call.alleles
    .map((a) => a ?? "?")
    .sort()
    .join("/");
export const isAutosome = (chrom: string) => /^(?:[1-9]|1\d|2[0-2])$/.test(chrom);
