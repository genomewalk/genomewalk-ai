/** Small, shared publication shards; no genome identities are included. */
import { AppError } from "../app-error.ts";
export const PUBLICATION_SHARDS = 64;
export const publicationShard = (pmid: string) =>
  (Number(pmid) % PUBLICATION_SHARDS).toString(16).padStart(2, "0");
export const validPmid = (id: string) => /^[1-9]\d{0,9}$/.test(id);
export type PublicationLabels = Record<string, string | null>;
export interface PublicationManifest {
  schema: 1;
  count: number;
  labeled: number;
  shards: Record<string, string>;
}
export function publicationManifest(value: unknown): PublicationManifest {
  const data = value as PublicationManifest | null;
  if (
    !data ||
    data.schema !== 1 ||
    !Number.isSafeInteger(data.count) ||
    data.count < 0 ||
    !Number.isSafeInteger(data.labeled) ||
    data.labeled < 0 ||
    data.labeled > data.count ||
    !data.shards ||
    typeof data.shards !== "object" ||
    Array.isArray(data.shards) ||
    Object.keys(data.shards).length !== PUBLICATION_SHARDS ||
    !Array.from({ length: PUBLICATION_SHARDS }, (_, i) => i.toString(16).padStart(2, "0")).every(
      (key) => /^[a-f0-9]{64}$/.test(data.shards[key] || ""),
    )
  )
    throw new AppError("REFERENCE_INDEX_INVALID", "Invalid publication manifest", {
      resource: "publication-index",
    });
  return data;
}
export function publicationLabels(value: unknown, shard: string): PublicationLabels {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Object.entries(value).every(
      ([id, label]) =>
        validPmid(id) &&
        publicationShard(id) === shard &&
        (label === null || (typeof label === "string" && !!label.trim() && label.length <= 500)),
    )
  )
    throw new AppError("REFERENCE_INDEX_INVALID", "Invalid publication labels", {
      resource: "publication-labels",
    });
  return value as PublicationLabels;
}
