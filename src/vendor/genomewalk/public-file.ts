import type { ErrorResource } from "./app-error.ts";

const publicFiles: Record<ErrorResource, RegExp> = {
  "public-sample": /^\/samples\/HG002_GRCh38\.vcf\.gz$/,
  "catalogue-index": /^\/ref\/GRCh(?:37|38)\/catalog\.meta\.json$/,
  "catalogue-entries": /^\/ref\/GRCh(?:37|38)\/catalog\.tsv\.gz$/,
  "consumer-lookup": /^\/ref\/consumer-dna\/GRCh(?:37|38)\/rsids\.json\.gz$/,
  markers: /^\/ref\/GRCh(?:37|38)\/markers\.json$/,
  "publication-index": /^\/ref\/publications\/index\.json$/,
  "publication-labels":
    /^\/ref\/publications\/(?:[0-3][0-9a-f]\.[a-f0-9]{64}|\[shard\])\.json\.gz$/,
};

/** Only reviewed public assets, never arbitrary URLs, query values or local filenames. */
export function safePublicFile(
  input: string | URL | Request | undefined,
  resource: ErrorResource | undefined,
): string | undefined {
  if (!input || !resource || !Object.hasOwn(publicFiles, resource)) return;
  const raw = input instanceof Request ? input.url : String(input);
  const path = raw.split(/[?#]/, 1)[0]!.replace(/^https:\/\/(?:www\.)?genomewalk\.com(?=\/)/, "");
  if (!publicFiles[resource]?.test(path)) return;
  // Shard selection follows viewed citations. Retain the file family, not its shard key/hash.
  return resource === "publication-labels" ? "/ref/publications/[shard].json.gz" : path;
}
