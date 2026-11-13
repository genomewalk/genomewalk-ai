import type { Generation } from '../lib/types.ts';
import { QUERY_SCHEMA } from './search-scope.ts';

// Independent of the answer model. Fixed public downloads; no inference API.
export const EMBEDDING_MODEL = Object.freeze({
  id: 'Xenova/all-MiniLM-L6-v2',
  revision: '751bff37182d3f1213fa05d7196b954e230abad9',
  dtype: 'q8',
  device: 'wasm',
});
export const RETRIEVAL = Object.freeze({ batchSize: 8, documentTokens: 256 });
// No arbitrary score cutoff: these scores are uncalibrated relevance scores.
// The answer prompt must distinguish retrieved candidates from supported answers.

// JSON grammar already constrains every generated token. WebLLM 0.2.87's
// enable_thinking:false prepends literal <think> tags OUTSIDE that grammar.
// Omit that convenience prefix for planning; never repair the returned JSON.
export const QUERY_GENERATION: Generation = Object.freeze({
  temperature: 0,
  top_p: 1,
  presence_penalty: 0,
  repetition_penalty: 1,
  max_tokens: 512,
  extra_body: Object.freeze({}),
  response_format: Object.freeze({ type: 'json_object', schema: JSON.stringify(QUERY_SCHEMA) }),
});
