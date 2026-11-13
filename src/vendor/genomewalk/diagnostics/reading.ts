/** Reviewed structural diagnostics only. Never add file-derived strings or numbers. */
export const readingVocabulary = {
  readerKind: ["consumer-dna", "vcf"],
  readingStep: [
    "format-detection",
    "read-bytes",
    "archive-directory",
    "decompress",
    "archive-integrity",
    "select-payload",
    "header",
    "first-record",
    "records",
  ],
  inputContainer: ["plain", "zip", "gzip", "bgzf"],
  textEncoding: ["utf8-bom", "utf16le-bom", "utf16be-bom", "unmarked"],
  headerProvider: ["23andMe", "AncestryDNA", "unrecognized"],
  headerLayout: ["genotype", "allele-pair", "other"],
  formatReason: ["provider-unrecognized", "columns-mismatch"],
  failureReason: [
    "header-ended-before-columns",
    "data-before-columns",
    "row-columns-too-few",
    "row-columns-too-many",
    "archive-end-missing",
    "directory-invalid",
    "directory-mismatch",
    "duplicate-entry",
    "split-or-zip64",
    "compression-unsupported",
    "decompression-failed",
    "payload-incomplete",
    "checksum-mismatch",
    "decoded-size-mismatch",
    "bgzf-signature-missing",
    "bgzf-extra-field-missing",
    "bgzf-header-incomplete",
    "bgzf-block-size-invalid",
    "decoded-size-invalid",
    "vcf-format-marker-missing",
    "vcf-column-header-missing",
  ],
} as const;

export type ReadingDetails = {
  -readonly [K in keyof typeof readingVocabulary]?: (typeof readingVocabulary)[K][number];
};

const wireKeys = {
  readerKind: "reader_kind",
  readingStep: "reading_step",
  inputContainer: "input_container",
  textEncoding: "text_encoding",
  headerProvider: "header_provider",
  headerLayout: "header_layout",
  formatReason: "format_reason",
  failureReason: "failure_reason",
} as const;

/** Also used on native errors so their class, stack, cause and identity stay intact. */
const contexts = new WeakMap<object, ReadingDetails>();

export function sanitizeReadingDetails(input: unknown): ReadingDetails {
  const output: ReadingDetails = {};
  if (!input || typeof input !== "object") return output;
  const source = input as Record<string, unknown>;
  for (const key of Object.keys(readingVocabulary) as (keyof ReadingDetails)[]) {
    const value = readingVocabulary[key].find((allowed) => allowed === source[key]);
    if (value) Object.assign(output, { [key]: value });
  }
  return output;
}

/** Inner failures have more precise context than outer reader wrappers. Aborts stay untouched. */
export function withReadingContext(error: unknown, context: ReadingDetails): unknown {
  if (
    error &&
    typeof error === "object" &&
    !(error instanceof Error && error.name === "AbortError")
  )
    contexts.set(error, { ...sanitizeReadingDetails(context), ...contexts.get(error) });
  return error;
}

export function getReadingContext(error: unknown): ReadingDetails {
  return error && typeof error === "object" ? { ...contexts.get(error) } : {};
}

export function readingProperties(input: unknown): Record<string, string> {
  const safe = sanitizeReadingDetails(input);
  const properties: Record<string, string> = {};
  for (const key of Object.keys(safe) as (keyof ReadingDetails)[])
    properties[wireKeys[key]] = safe[key]!;
  return properties;
}

/** A second allowlist check at the final outbound SDK boundary. */
export function sanitizeReadingProperties(input: Record<string, unknown>): Record<string, string> {
  const details: Record<string, unknown> = {};
  for (const key of Object.keys(wireKeys) as (keyof ReadingDetails)[])
    details[key] = input[wireKeys[key]];
  return readingProperties(details);
}
