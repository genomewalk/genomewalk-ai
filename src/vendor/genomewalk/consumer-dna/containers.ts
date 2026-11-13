import { AppError } from "../app-error.ts";
import type { Progress } from "../io/types.ts";
interface Checksum {
  crc: number;
  size: number;
}
interface DecodedEntry {
  chunks: Uint8Array<ArrayBuffer>[];
  finished: boolean;
  expected?: Checksum | undefined;
}
import { Gunzip, Unzip, UnzipInflate, strFromU8 } from "fflate";
import { crc32 } from "../io/checksum.ts";
import { yieldToLoop } from "../async/schedule.ts";
import { describeHeader, detectHeaderProvider } from "./reader/header.ts";
import {
  getReadingContext,
  sanitizeReadingDetails,
  withReadingContext,
  type ReadingDetails,
} from "../diagnostics/reading.ts";

const textDiagnostics = new WeakMap<Blob, ReadingDetails>();

/** Only fixed structural hints survive alongside a decoded Blob. */
export function getTextDiagnostics(file: Blob): ReadingDetails {
  return { ...textDiagnostics.get(file) };
}

function rememberText(file: Blob, inputContainer: NonNullable<ReadingDetails["inputContainer"]>) {
  textDiagnostics.set(file, { readerKind: "consumer-dna", inputContainer });
  return file;
}

interface PayloadFormat {
  format: "vcf" | "consumer" | "other";
  diagnostics?: ReadingDetails;
}

/** Inspect the header; never infer a provider from an archive entry's name. */
async function payloadFormat(file: Blob, signal?: AbortSignal): Promise<PayloadFormat> {
  const meta: string[] = [];
  let reason: ReadingDetails["failureReason"] = "header-ended-before-columns";
  try {
    for await (const line of textLines(file, null, signal)) {
      const content = line.replace(/^#+\s*/, "").trim();
      if (/^##fileformat=VCF/.test(line)) return { format: "vcf" };
      if (/^rsid\s*\t/i.test(content)) {
        describeHeader(
          meta,
          content.split("\t").map((value) => value.trim()),
        );
        return { format: "consumer" };
      }
      if (line.startsWith("#")) meta.push(line);
      else if (line.trim()) {
        reason = "data-before-columns";
        break;
      }
    }
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "DNA_FORMAT_UNSUPPORTED") {
      const provider = detectHeaderProvider(meta);
      throw withReadingContext(error, {
        ...getTextDiagnostics(file),
        readingStep: "header",
        ...(provider ? { headerProvider: provider } : {}),
      });
    }
    return {
      format: "other",
      diagnostics: sanitizeReadingDetails({
        ...getTextDiagnostics(file),
        ...getReadingContext(error),
        ...error.details,
      }),
    };
  }
  const provider = detectHeaderProvider(meta);
  return {
    format: "other",
    // Ordinary README text is not a competing DNA candidate.
    ...(provider
      ? {
          diagnostics: sanitizeReadingDetails({
            ...getTextDiagnostics(file),
            headerProvider: provider,
            failureReason: reason,
          }),
        }
      : {}),
  };
}

function archiveDecodeError(error: unknown) {
  // fflate's data-error codes are distinct from programming/stream-usage errors.
  // Its ZIP callback can also relay non-Error values, including Firefox's OOM string.
  if (!(error instanceof Error)) return error;
  const code = "code" in error ? error.code : undefined;
  if (code === 14)
    return new AppError(
      "ARCHIVE_UNSUPPORTED",
      "This archive uses an unsupported compression method. Choose the extracted TXT file.",
      { failureReason: "compression-unsupported" },
    );
  if (typeof code === "number" && [0, 1, 2, 3, 6, 8, 13].includes(code))
    return new AppError(
      "ARCHIVE_INVALID",
      "The DNA archive could not be decompressed. Download it again or choose the extracted TXT file.",
      { failureReason: "decompression-failed" },
    );
  return error;
}

export async function unpack(file: Blob, signal?: AbortSignal, onProgress?: Progress) {
  const context: ReadingDetails = { readerKind: "consumer-dna", readingStep: "read-bytes" };
  try {
    return await unpackFile(file, context, signal, onProgress);
  } catch (error) {
    throw withReadingContext(error, context);
  }
}

async function unpackFile(
  file: Blob,
  context: ReadingDetails,
  signal?: AbortSignal,
  onProgress?: Progress,
) {
  signal?.throwIfAborted();
  if (!file.size)
    throw new AppError("FILE_EMPTY", "This file is empty. Download the raw DNA export again.");
  const magic = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  signal?.throwIfAborted();
  const zip = magic[0] === 80 && magic[1] === 75;
  const gzip = magic[0] === 31 && magic[1] === 139;
  context.inputContainer = zip ? "zip" : gzip ? "gzip" : "plain";
  if (!zip && !gzip) return rememberText(file, "plain");
  let failure: { error: unknown } | null = null;
  const entries: DecodedEntry[] = [];
  const localNames = new Set<string>();
  let localEntryCount = 0;
  let hasVcfPayload = false;
  const append = (entry: DecodedEntry, data: Uint8Array<ArrayBuffer>, final: boolean) => {
    if (failure) return;
    entry.chunks.push(data);
    entry.finished = final;
  };
  let decoder: Unzip | Gunzip;
  let expectedGzip: Checksum | null = null;
  const checksums = new Map<string, Checksum>();
  if (zip) {
    context.readingStep = "archive-directory";
    // A ZIP's end record must still be present, even if its first payload
    // decompressed successfully. Reject partial downloads and split archives.
    const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 65557)).arrayBuffer());
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (
        tail[i] === 80 &&
        tail[i + 1] === 75 &&
        tail[i + 2] === 5 &&
        tail[i + 3] === 6 &&
        i + 22 + (tail[i + 20]! | (tail[i + 21]! << 8)) === tail.length
      ) {
        end = i;
        break;
      }
    }
    if (end < 0)
      throw new AppError(
        "ARCHIVE_INVALID",
        "The ZIP is incomplete. Download it again or choose the extracted TXT file.",
        { failureReason: "archive-end-missing" },
      );
    const directory = new DataView(tail.buffer, tail.byteOffset + end);
    if (
      directory.getUint16(4, true) ||
      directory.getUint16(6, true) ||
      directory.getUint16(10, true) === 65535
    )
      throw new AppError(
        "ARCHIVE_UNSUPPORTED",
        "Split and ZIP64 archives are not supported. Choose the extracted TXT file.",
        { failureReason: "split-or-zip64" },
      );
    const count = directory.getUint16(10, true);
    const centralSize = directory.getUint32(12, true);
    const centralOffset = directory.getUint32(16, true);
    if (centralOffset + centralSize > file.size - (tail.length - end))
      throw new AppError(
        "ARCHIVE_INVALID",
        "The ZIP directory is invalid. Choose the extracted TXT file.",
        { failureReason: "directory-invalid" },
      );
    const central = new Uint8Array(
      await file.slice(centralOffset, centralOffset + centralSize).arrayBuffer(),
    );
    let offset = 0;
    for (let index = 0; index < count; index++) {
      if (offset + 46 > central.length)
        throw new AppError("ARCHIVE_INVALID", "The ZIP directory is incomplete.", {
          failureReason: "directory-invalid",
        });
      const record = new DataView(central.buffer, central.byteOffset + offset);
      if (record.getUint32(0, true) !== 0x02014b50)
        throw new AppError("ARCHIVE_INVALID", "The ZIP directory is invalid.", {
          failureReason: "directory-invalid",
        });
      const nameLength = record.getUint16(28, true);
      const next =
        offset + 46 + nameLength + record.getUint16(30, true) + record.getUint16(32, true);
      if (next > central.length)
        throw new AppError("ARCHIVE_INVALID", "The ZIP directory is incomplete.", {
          failureReason: "directory-invalid",
        });
      let name: string;
      try {
        name = strFromU8(
          central.subarray(offset + 46, offset + 46 + nameLength),
          !(record.getUint16(8, true) & 2048),
        );
      } catch (error) {
        throw error instanceof Error ? archiveDecodeError(error) : error;
      }
      if (checksums.has(name))
        throw new AppError(
          "ARCHIVE_INVALID",
          "The ZIP directory contains duplicate file entries.",
          {
            failureReason: "duplicate-entry",
          },
        );
      checksums.set(name, { crc: record.getUint32(16, true), size: record.getUint32(24, true) });
      offset = next;
    }
    decoder = new Unzip((entry) => {
      if (failure) return;
      localEntryCount++;
      if (localEntryCount > count || !checksums.has(entry.name) || localNames.has(entry.name)) {
        failure = {
          error: new AppError("ARCHIVE_INVALID", "The ZIP contents do not match its directory.", {
            failureReason: "directory-mismatch",
          }),
        };
        return;
      }
      localNames.add(entry.name);
      if (entry.name.startsWith("__MACOSX/") || /(?:^|\/)\.[^/]+$/.test(entry.name)) return;
      if (/\.(?:g?vcf)(?:\.(?:gz|bgz))?$/i.test(entry.name)) hasVcfPayload = true;
      if (!/\.(txt|csv|tsv)$/i.test(entry.name)) return;
      const expected = checksums.get(entry.name);
      const output: DecodedEntry = {
        chunks: [],
        finished: false,
        expected,
      };
      entries.push(output);
      entry.ondata = (err, data, final) => {
        if (failure) return;
        if (err !== null) failure = { error: archiveDecodeError(err) };
        else append(output, data, final);
      };
      entry.start();
    });
    decoder.register(UnzipInflate);
  } else {
    context.readingStep = "archive-integrity";
    if (file.size < 18)
      throw new AppError("ARCHIVE_INVALID", "The gzip file is incomplete.", {
        failureReason: "archive-end-missing",
      });
    const footer = new DataView(await file.slice(file.size - 8).arrayBuffer());
    expectedGzip = { crc: footer.getUint32(0, true), size: footer.getUint32(4, true) };
    const output: DecodedEntry = { chunks: [], finished: false };
    entries.push(output);
    decoder = new Gunzip((data, final) => append(output, data, final));
  }
  onProgress?.(0);
  context.readingStep = "decompress";
  for (let offset = 0; offset < file.size; offset += 65536) {
    signal?.throwIfAborted();
    const end = Math.min(offset + 65536, file.size);
    let chunk: Uint8Array<ArrayBuffer>;
    try {
      chunk = new Uint8Array(await file.slice(offset, end).arrayBuffer());
    } catch (error) {
      throw withReadingContext(error, { readingStep: "read-bytes" });
    }
    signal?.throwIfAborted();
    try {
      decoder.push(chunk, end === file.size);
    } catch (error) {
      throw error instanceof Error ? archiveDecodeError(error) : error;
    }
    if (failure) throw failure.error;
    onProgress?.(end / file.size);
    await yieldToLoop();
  }
  if (zip && localEntryCount !== checksums.size)
    throw new AppError("ARCHIVE_INVALID", "The ZIP contents do not match its directory.", {
      failureReason: "directory-mismatch",
    });
  let selected: Blob | undefined;
  let rejected: ReadingDetails | undefined;
  let conflictingCandidates = false;
  for (const output of entries) {
    context.readingStep = "archive-integrity";
    signal?.throwIfAborted();
    if (!output.finished)
      throw new AppError(
        "ARCHIVE_INVALID",
        "The archive's text file is incomplete. Download it again or choose the extracted TXT file.",
        { failureReason: "payload-incomplete" },
      );
    const expected = output.expected || expectedGzip;
    const text = new Blob(output.chunks, { type: "text/plain" });
    // The gzip ISIZE footer stores decoded size modulo 2^32; ZIP sizes are exact.
    const expectedSize = zip ? text.size : text.size % 0x100000000;
    if (
      !expected ||
      expected.size !== expectedSize ||
      output.chunks.reduce((crc, bytes) => crc32(bytes, crc), 0) !== expected.crc
    )
      throw new AppError(
        "ARCHIVE_INVALID",
        "The DNA archive failed its integrity check. Download it again or choose the extracted TXT file.",
        {
          failureReason:
            !expected || expected.size !== expectedSize
              ? "decoded-size-mismatch"
              : "checksum-mismatch",
        },
      );
    rememberText(text, zip ? "zip" : "gzip");
    if (!zip) return text;
    context.readingStep = "select-payload";
    const { format, diagnostics } = await payloadFormat(text, signal);
    if (format === "vcf") hasVcfPayload = true;
    if (format !== "consumer") {
      if (diagnostics) {
        if (rejected && JSON.stringify(rejected) !== JSON.stringify(diagnostics))
          conflictingCandidates = true;
        else rejected = diagnostics;
      }
      continue;
    }
    if (selected)
      throw new AppError(
        "ARCHIVE_MULTIPLE_DNA",
        "This ZIP contains more than one supported DNA text file. Extract it and choose one file.",
      );
    selected = text;
  }
  if (selected) return selected;
  if (hasVcfPayload)
    throw new AppError(
      "ARCHIVE_VCF_UNSUPPORTED",
      "This ZIP contains VCF data. Extract it and choose the .vcf or .vcf.gz file.",
    );
  throw new AppError(
    "ARCHIVE_NO_DNA",
    "No supported DNA text file was found in this ZIP. Choose the original raw 23andMe or AncestryDNA TXT export, or try the public sample.",
    conflictingCandidates ? {} : rejected,
  );
}

export async function* textLines(file: Blob, onProgress?: Progress | null, signal?: AbortSignal) {
  const decoder = new TextDecoder();
  let carry = "",
    first = true;
  for (let offset = 0; offset < file.size; offset += 256 * 1024) {
    signal?.throwIfAborted();
    const end = Math.min(offset + 256 * 1024, file.size);
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer());
    } catch (error) {
      throw withReadingContext(error, { ...getTextDiagnostics(file), readingStep: "read-bytes" });
    }
    if (first)
      textDiagnostics.set(file, {
        ...getTextDiagnostics(file),
        textEncoding:
          bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
            ? "utf8-bom"
            : bytes[0] === 0xff && bytes[1] === 0xfe
              ? "utf16le-bom"
              : bytes[0] === 0xfe && bytes[1] === 0xff
                ? "utf16be-bom"
                : "unmarked",
      });
    let text = decoder.decode(bytes, {
      stream: end !== file.size,
    });
    if (first) {
      text = text.replace(/^\uFEFF/, "");
      first = false;
    }
    carry += text;
    const parts = carry.split("\n");
    carry = parts.pop()!;
    for (const line of parts) yield line.replace(/\r$/, "");
    onProgress?.(end / file.size);
    await yieldToLoop();
  }
  if (carry) yield carry.replace(/\r$/, "");
  signal?.throwIfAborted();
  onProgress?.(1);
}
