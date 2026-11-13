import { AppError } from "../app-error.ts";
import type { ConsumerSource, ConsumerHeader } from "./types.ts";
import type { Progress } from "../io/types.ts";
import { unpack, textLines, getTextDiagnostics } from "./containers.ts";
import { describeHeader, detectHeaderProvider } from "./reader/header.ts";
import { decodeConsumerCall } from "./reader/call.ts";
import { withReadingContext, type ReadingDetails } from "../diagnostics/reading.ts";

export { describeHeader, decodeConsumerCall };

const missingHeaderMessage =
  "We couldn’t find the expected DNA file header. Choose a raw 23andMe or AncestryDNA export, or try the public sample.";

export async function openConsumerFile(file: File, signal?: AbortSignal, onProgress?: Progress) {
  const meta: string[] = [];
  let text: Blob | undefined;
  let inspectedHeader = false;
  try {
    text = await unpack(file, signal, onProgress);
    if (!text.size)
      throw new AppError("FILE_EMPTY", "This file is empty. Download the raw DNA export again.");
    const headerLines: ConsumerHeader["lines"] = [];
    let columns = null;
    let lineNumber = 0;
    for await (const line of textLines(text, null, signal)) {
      inspectedHeader = true;
      lineNumber++;
      const content = line.replace(/^#+\s*/, "").trim();
      if (/^rsid\s*\t/i.test(content)) {
        columns = content.split("\t").map((s) => s.trim());
        headerLines.push({ text: line, number: lineNumber, columns: true });
        break;
      }
      if (line.startsWith("#")) {
        meta.push(line);
        headerLines.push({ text: line, number: lineNumber });
      } else if (line.trim())
        throw new AppError("DNA_HEADER_MISSING", missingHeaderMessage, {
          failureReason: "data-before-columns",
        });
    }
    if (!columns)
      throw new AppError("DNA_HEADER_MISSING", missingHeaderMessage, {
        failureReason: "header-ended-before-columns",
      });
    const profile = describeHeader(meta, columns);
    const payload = text;
    let opening = true;
    const context: ReadingDetails = {
      ...getTextDiagnostics(payload),
      readerKind: "consumer-dna",
      headerProvider: profile.provider,
      headerLayout: profile.provider === "23andMe" ? "genotype" : "allele-pair",
    };
    const source: ConsumerSource = {
      file,
      size: file.size,
      bytesRead: 0,
      format: "consumer",
      label: profile.provider,
      ...profile,
      header: { meta, columns, lines: headerLines },
      capabilities: {
        matching: ["GRCh37", "GRCh38"].includes(profile.build) && profile.strand === "forward",
        quality: false,
        depth: false,
        referenceBlocks: false,
      },
      async readCalls(each, onProgress, callSignal) {
        try {
          let pastHeader = false,
            count = 0;
          for await (const line of textLines(payload, onProgress, callSignal)) {
            const content = line.replace(/^#+\s*/, "").trim();
            if (/^rsid\s*\t/i.test(content)) {
              pastHeader = true;
              continue;
            }
            if (!pastHeader || !line.trim() || line.startsWith("#")) continue;
            each(
              decodeConsumerCall(
                line.split("\t").map((s) => s.trim()),
                source,
              ),
            );
            count++;
          }
          if (!count) throw new AppError("DNA_NO_ROWS", "This DNA export has no data rows.");
        } catch (error) {
          throw withReadingContext(error, {
            ...context,
            readingStep: opening ? "first-record" : "records",
          });
        }
      },
    };
    // Validate the first row during selection without retaining the entire genome.
    const stop = Symbol("first call");
    try {
      await source.readCalls(
        (call) => {
          source.example = call;
          throw stop;
        },
        null,
        signal,
      );
    } catch (e) {
      if (e !== stop) throw e;
    }
    opening = false;
    return source;
  } catch (error) {
    throw withReadingContext(error, {
      readerKind: "consumer-dna",
      readingStep: "header",
      ...(text ? getTextDiagnostics(text) : {}),
      ...(inspectedHeader ? { headerProvider: detectHeaderProvider(meta) || "unrecognized" } : {}),
    });
  }
}
