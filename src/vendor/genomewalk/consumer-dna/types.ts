import type { CatalogEntry } from "../catalogues/types.ts";
import type { Progress } from "../io/types.ts";
import type { describeHeader } from "./reader/header.ts";
import type { decodeConsumerCall } from "./reader/call.ts";

export type ConsumerProfile = ReturnType<typeof describeHeader>;
export type ConsumerCall = ReturnType<typeof decodeConsumerCall>;
export interface ConsumerHeader {
  meta: string[];
  columns: string[];
  lines: { text: string; number: number; columns?: boolean }[];
}
/** The matcher needs calls and build metadata, independent of file packaging. */
export interface CallSource {
  build: string;
  capabilities?: { matching: boolean };
  readCalls(
    each: (call: ConsumerCall) => void,
    onProgress?: Progress | null,
    signal?: AbortSignal,
  ): Promise<void>;
}
export interface ConsumerSource extends ConsumerProfile, CallSource {
  file: File;
  size: number;
  bytesRead: number;
  format: string;
  label: string;
  header: ConsumerHeader;
  example?: ConsumerCall;
  capabilities: { matching: boolean; quality: boolean; depth: boolean; referenceBlocks: boolean };
}

export type CountExample = ConsumerCall & { fileRow: number };
export interface RepeatedExample {
  call: CountExample;
  previous: string;
  row: number;
  earlier?: CountExample;
  separated?: boolean;
}
export interface CountExamples {
  first?: CountExample;
  called?: CountExample;
  "no-call"?: CountExample;
  partial?: CountExample;
  unsupported?: CountExample;
  matchable?: CountExample;
  outsideMatching?: CountExample;
  insertion?: CountExample;
  deletion?: CountExample;
  anyRepeated?: RepeatedExample;
  repeated?: RepeatedExample;
  conflicting?: RepeatedExample;
}
export interface ConsumerCounts {
  records: number;
  called: number;
  missing: number;
  partial: number;
  unsupported: number;
  eligible: number;
  duplicates: number;
  chrom: Record<string, number>;
  heterozygous: number;
  diploid: number;
  examples: CountExamples;
}
export interface ConsumerMarkerHit {
  call: ConsumerCall;
  letters: string[];
  filter: string;
  usable: boolean;
  conflicting: boolean;
}
export interface LookupIssue {
  type: string;
  build: string;
  call: ConsumerCall;
  resolvedRsid: string | null;
  referencePositions: string[];
}
export interface RsidLookup {
  schema: number;
  build: string;
  aliases: Record<string, string>;
  catalog: Record<string, string[]>;
  markers: Record<string, string[]>;
  sources: Record<string, { sha256: string }>;
}

export interface ConsumerMatch extends CatalogEntry {
  call: ConsumerCall;
  copies: number;
  ploidy: number | null;
  gt: string;
  partialCall: boolean;
  conflictingRecords: boolean;
  recordCount: number;
  sourceCalls: string[][];
}
