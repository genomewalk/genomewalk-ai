import type { Generation } from '../lib/types.ts';
import { QUERY_SCHEMA } from './query-schema.ts';

// Independent of the answer model. Fixed public downloads; no inference API.
export const EMBEDDING_MODEL = Object.freeze({
  id: 'answerdotai/answerai-colbert-small-v1',
  revision: '934fa8bb4ce2284f4c2baa232d81aca4d076fa5e',
  // The publisher's root ONNX includes the trained 384 → 96 projection.
  // onnx/model.onnx contains only the backbone and is not interchangeable.
  subfolder: '',
  dtype: 'fp32',
  device: 'wasm',
});
// ColBERT Small checkpoint defaults, not query-specific tuning.
export const RETRIEVAL = Object.freeze({
  batchSize: 8,
  documentTokens: 300,
  queryTokens: 32,
  dimensions: 96,
});
// No arbitrary score cutoff: these scores are uncalibrated relevance scores.
// The answer prompt must distinguish retrieved candidates from supported answers.

// JSON grammar already constrains every generated token. WebLLM 0.2.87's
// enable_thinking:false prepends literal <think> tags OUTSIDE that grammar.
// Omit that convenience prefix for planning; never repair the returned JSON.
export const QUERY_GENERATION: Generation = Object.freeze({
  // Fixed query generation settings; answer calls use the model profile's defaults.
  temperature: 0,
  top_p: 1,
  seed: 42,
  presence_penalty: 0,
  repetition_penalty: 1,
  max_tokens: 512,
  extra_body: Object.freeze({}),
  response_format: Object.freeze({ type: 'json_object', schema: JSON.stringify(QUERY_SCHEMA) }),
});
