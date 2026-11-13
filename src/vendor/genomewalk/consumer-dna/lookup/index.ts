import type { ConsumerCall, LookupIssue, RsidLookup } from "../types.ts";
import type { VariantIdentity } from "../../catalogues/types.ts";
import type { Fetcher } from "../../io/types.ts";
import { AppError } from "../../app-error.ts";
import { fetchPublic, readPublicBytes, decodePublicJson } from "../../io/fetch-public.ts";

const canonicalRsid = (id: string | null | undefined) => {
  const match = /^rs([1-9]\d*)$/i.exec(id || "");
  return match ? `rs${match[1]}` : null;
};

export async function sha256(bytes: BufferSource) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function loadLookup(
  build: string,
  kind: "catalog" | "markers",
  sourceBytes: Uint8Array<ArrayBuffer> | { sha256: string },
  signal?: AbortSignal,
  fetcher: Fetcher = fetch,
) {
  signal?.throwIfAborted();
  // Fixed public resources only: the request never contains a person's rsIDs.
  const response = await fetchPublic(
    `/ref/consumer-dna/${build}/rsids.json.gz`,
    "consumer-lookup",
    {
      signal: signal ?? null,
    },
    fetcher,
  );
  const bytes = await readPublicBytes(response, "consumer-lookup");
  const index = decodePublicJson<RsidLookup>(bytes, "consumer-lookup");
  signal?.throwIfAborted();
  await validateLookup(index, build, kind, sourceBytes);
  signal?.throwIfAborted();
  return index;
}

export async function validateLookup(
  index: RsidLookup,
  build: string,
  kind: "catalog" | "markers",
  sourceBytes: Uint8Array<ArrayBuffer> | { sha256: string },
) {
  // Metadata binds this sidecar to the catalogue; the complete catalogue stream verifies its hash.
  const sourceHash =
    sourceBytes instanceof Uint8Array ? await sha256(sourceBytes) : sourceBytes?.sha256;
  if (
    index.schema !== 1 ||
    index.build !== build ||
    !["catalog", "markers"].includes(kind) ||
    !index[kind] ||
    !index.aliases ||
    !/^[a-f0-9]{64}$/.test(sourceHash) ||
    index.sources?.[kind]?.sha256 !== sourceHash
  )
    throw new AppError(
      "REFERENCE_INTEGRITY_FAILED",
      "Consumer rsID lookup does not match this reference release. Rebuild the indexes together.",
      { resource: "consumer-lookup" },
    );
  const keys = /^(?:[1-9]|1\d|2[0-2]|X|Y|MT):[1-9]\d*:[ACGT]:[ACGT]$/;
  for (const [rs, entries] of Object.entries(index[kind])) {
    if (
      canonicalRsid(rs) !== rs ||
      !Array.isArray(entries) ||
      !entries.length ||
      entries.some((key) => !keys.test(key))
    )
      throw new AppError("REFERENCE_INDEX_INVALID", "Invalid consumer rsID lookup entry", {
        resource: "consumer-lookup",
      });
  }
  for (const [old, current] of Object.entries(index.aliases)) {
    if (
      canonicalRsid(old) !== old ||
      canonicalRsid(current) !== current ||
      old === current ||
      index.aliases[current]
    )
      throw new AppError("REFERENCE_INDEX_INVALID", "Invalid consumer rsID alias", {
        resource: "consumer-lookup",
      });
  }
}

export function createCandidates<T extends VariantIdentity>(
  records: T[],
  lookup: RsidLookup | null,
  kind: "catalog" | "markers",
  build: string,
  onIssue: (issue: LookupIssue) => void = () => {},
) {
  if (lookup && lookup.build !== build)
    throw new AppError("REFERENCE_BUILD_MISMATCH", "Consumer rsID lookup build mismatch", {
      resource: "consumer-lookup",
    });
  const byPosition = new Map<string, T[]>();
  for (const record of records) {
    const position = `${record.chrom}:${record.pos}`;
    if (!byPosition.has(position)) byPosition.set(position, []);
    byPosition.get(position)!.push(record);
  }
  return (call: ConsumerCall) => {
    const id = canonicalRsid(call.id);
    const resolved = (id ? lookup?.aliases[id] : undefined) || id;
    const keys = resolved ? lookup?.[kind]?.[resolved] : undefined;
    const position = `${call.chrom}:${call.pos}`;
    // Coordinates select candidates. An rsID is an additional location check,
    // not a requirement: catalogue IDs can be missing or cover only some alleles.
    if (keys && !keys.some((key) => key.startsWith(`${position}:`))) {
      onIssue({
        type: "rsid-position-conflict",
        build,
        call,
        resolvedRsid: resolved,
        referencePositions: [...new Set(keys.map((key) => key.split(":", 2).join(":")))],
      });
      return [];
    }
    return byPosition.get(position) || [];
  };
}
