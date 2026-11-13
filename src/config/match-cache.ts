// Testing convenience for Local + Embeddings only. Bump pipelineVersion when
// matching or annotation hydration changes; old evidence must be recomputed.
export const MATCH_CACHE = Object.freeze({
  key: 'genomewalk.local-matches',
  schemaVersion: 1,
  pipelineVersion: 'genomewalk-filter-v2',
  maxCharacters: 2_000_000,
});
