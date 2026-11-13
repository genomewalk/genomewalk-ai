import type { Progress } from "../io/types.ts";

/** Re-openable public rows. A plain map is useful for small fixtures and tools. */
export type CatalogueRows =
  | { rows(signal?: AbortSignal, onProgress?: Progress): AsyncIterable<string> }
  | Map<string, string>;

export async function* catalogueRows(
  catalogue: CatalogueRows,
  signal?: AbortSignal,
  onProgress?: Progress,
) {
  signal?.throwIfAborted();
  if (!(catalogue instanceof Map)) {
    yield* catalogue.rows(signal, onProgress);
    return;
  }
  let count = 0;
  for (const row of catalogue.values()) {
    signal?.throwIfAborted();
    yield row;
    onProgress?.(++count / catalogue.size);
  }
  onProgress?.(1);
}

/** Keep payloads only for requested identities; consume the entire integrity-checked stream. */
export async function matchingRows(
  catalogue: CatalogueRows,
  keys: ReadonlySet<string>,
  signal?: AbortSignal,
  onProgress?: Progress,
) {
  const matches = new Map<string, string>();
  if (!keys.size) return matches;
  for await (const line of catalogueRows(catalogue, signal, onProgress)) {
    const key = line.split("\t", 4).join(":");
    if (keys.has(key)) matches.set(key, line);
  }
  return matches;
}
