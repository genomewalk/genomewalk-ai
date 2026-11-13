import { AppError } from "../app-error.ts";
import type { ByteSource } from "./types.ts";
import { crc32 } from "./checksum.ts";
import { gunzipSync } from "fflate";
import { withReadingContext, type ReadingDetails } from "../diagnostics/reading.ts";

/** Random-access local file. No network operations occur in this reader. */
export class FileSource implements ByteSource {
  declare readonly file: File;
  declare readonly size: number;
  declare bytesRead: number;
  constructor(file: File) {
    this.file = file;
    this.size = file.size;
    this.bytesRead = 0;
  }
  async slice(start: number, end: number) {
    try {
      const bytes = new Uint8Array(await this.file.slice(start, end).arrayBuffer());
      this.bytesRead += bytes.length;
      return bytes;
    } catch (error) {
      throw withReadingContext(error, { readerKind: "vcf", readingStep: "read-bytes" });
    }
  }
}

/** Returns the BGZF block size, or -1 until its extra fields are buffered. */
export function blockLength(bytes: Uint8Array, at = 0) {
  if (at + 12 > bytes.length) return -1;
  if (bytes[at]! !== 31 || bytes[at + 1]! !== 139 || bytes[at + 2]! !== 8 || !(bytes[at + 3]! & 4))
    throw new AppError(
      "VCF_BGZF_REQUIRED",
      "Choose a bgzip-compressed VCF or gVCF (.gz or .bgz).",
      {
        readingStep: "format-detection",
        failureReason: "bgzf-signature-missing",
        ...(bytes[at] === 31 && bytes[at + 1] === 139 ? { inputContainer: "gzip" } : {}),
      },
    );
  const extraEnd = at + 12 + (bytes[at + 10]! | (bytes[at + 11]! << 8));
  if (extraEnd > bytes.length) return -1;
  for (let offset = at + 12; offset + 4 <= extraEnd;) {
    const length = bytes[offset + 2]! | (bytes[offset + 3]! << 8);
    if (offset + 4 + length > extraEnd)
      throw new AppError("VCF_BLOCK_INVALID", "The BGZF header is incomplete.", {
        failureReason: "bgzf-header-incomplete",
      });
    if (bytes[offset] === 66 && bytes[offset + 1] === 67 && length === 2) {
      const size = (bytes[offset + 4]! | (bytes[offset + 5]! << 8)) + 1;
      if (size < extraEnd - at + 8)
        throw new AppError("VCF_BLOCK_INVALID", "The BGZF block size is invalid.", {
          inputContainer: "bgzf",
          failureReason: "bgzf-block-size-invalid",
        });
      return size;
    }
    offset += 4 + length;
  }
  throw new AppError(
    "VCF_BGZF_REQUIRED",
    "This gzip file is not BGZF. Compress the VCF or gVCF with bgzip first.",
    {
      inputContainer: "gzip",
      readingStep: "format-detection",
      failureReason: "bgzf-extra-field-missing",
    },
  );
}

/** Read a compressed stream without buffering it in full. Each yielded block is independent. */
export async function* streamBgzfChunks(chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal) {
  let offset = 0;
  let bytes: Uint8Array = new Uint8Array(0);
  let readingStep: ReadingDetails["readingStep"] = "decompress";
  let inputContainer: ReadingDetails["inputContainer"];
  try {
    for await (const chunk of chunks) {
      signal?.throwIfAborted();
      if (!chunk.length) continue;
      if (bytes.length) {
        const merged = new Uint8Array(bytes.length + chunk.length);
        merged.set(bytes);
        merged.set(chunk, bytes.length);
        bytes = merged;
      } else bytes = chunk;
      while (bytes.length) {
        signal?.throwIfAborted();
        readingStep = "decompress";
        if (!inputContainer && bytes[0] === 31 && bytes[1] === 139) inputContainer = "gzip";
        const size = blockLength(bytes);
        if (size > 0) inputContainer = "bgzf";
        if (size < 0 || bytes.length < size) break;
        const block = bytes.subarray(0, size);
        const footer = new DataView(block.buffer, block.byteOffset + size - 8, 8);
        // fflate uses ISIZE when allocating output; validate it before decoding.
        if (footer.getUint32(4, true) > 65536)
          throw new AppError(
            "VCF_BLOCK_INVALID",
            "The BGZF block exceeds its maximum decoded size.",
            { failureReason: "decoded-size-invalid" },
          );
        let data: Uint8Array<ArrayBuffer>;
        try {
          data = gunzipSync(block);
        } catch (error) {
          // Classify only fflate data errors; unexpected failures retain their native type.
          if (
            error instanceof Error &&
            "code" in error &&
            typeof error.code === "number" &&
            [0, 1, 2, 3, 6].includes(error.code)
          )
            throw new AppError(
              "VCF_BLOCK_INVALID",
              "A BGZF block could not be decompressed. Choose a complete, unmodified file.",
              { failureReason: "decompression-failed" },
            );
          throw error;
        }
        readingStep = "archive-integrity";
        const failureReason =
          data.length > 65536
            ? "decoded-size-invalid"
            : data.length !== footer.getUint32(4, true)
              ? "decoded-size-mismatch"
              : crc32(data) !== footer.getUint32(0, true)
                ? "checksum-mismatch"
                : undefined;
        if (failureReason)
          throw new AppError(
            "VCF_BLOCK_INVALID",
            "A BGZF block failed its integrity check. Choose a complete, unmodified file.",
            { failureReason },
          );
        yield { data, offset, blockLen: size };
        offset += size;
        bytes = bytes.subarray(size);
      }
      // A partial block must not retain the backing buffer of a large processed chunk.
      bytes = bytes.slice();
    }
    signal?.throwIfAborted();
    if (bytes.length)
      throw new AppError("VCF_TRUNCATED", "The BGZF file is truncated. Choose a complete file.", {
        failureReason: "payload-incomplete",
      });
  } catch (error) {
    throw withReadingContext(error, {
      readingStep,
      ...(inputContainer ? { inputContainer } : {}),
    });
  }
}

/** Local/random-access inputs use the same block decoder as sequential HTTP bodies. */
export async function* streamBlocks(source: ByteSource, chunkSize = 4 << 20, signal?: AbortSignal) {
  async function* chunks() {
    let position = 0;
    while (position < source.size) {
      signal?.throwIfAborted();
      let chunk: Uint8Array;
      try {
        chunk = await source.slice(position, Math.min(position + chunkSize, source.size), signal);
      } catch (error) {
        throw withReadingContext(error, { readingStep: "read-bytes" });
      }
      if (!chunk.length)
        throw withReadingContext(
          new AppError("FILE_READ_FAILED", "The genome file could not be read completely.", {
            failureReason: "payload-incomplete",
          }),
          { readingStep: "read-bytes" },
        );
      position += chunk.length;
      yield chunk;
    }
  }
  try {
    yield* streamBgzfChunks(chunks(), signal);
  } catch (error) {
    throw withReadingContext(error, source instanceof FileSource ? { readerKind: "vcf" } : {});
  }
}
