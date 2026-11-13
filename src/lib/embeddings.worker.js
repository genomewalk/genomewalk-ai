import { pipeline, env } from '@huggingface/transformers';
import wasmURL from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';
import wasmModuleURL from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url';
import { EMBEDDING_MODEL, RETRIEVAL } from '../config/embeddings.js';
import { cosineSimilarity } from './semantic-search.js';

env.allowLocalModels = false;
env.useBrowserCache = true; // Public model assets only. No personal index persistence.
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.wasmPaths = { wasm: wasmURL, mjs: wasmModuleURL };
let embedder;
let documentCount = 0;
let vectors = [];
const progress = (id, message) => self.postMessage({ id, type: 'progress', message });
const options = (model, id) => ({
  ...model,
  progress_callback: (event) => {
    if (event.status === 'progress')
      progress(
        id,
        `Loading ${model.id.split('/').at(-1)} · ${Math.round(event.progress ?? 0)}% of ${event.file}`,
      );
  },
});

self.onmessage = async ({ data: { id, operation, payload } }) => {
  try {
    if (operation === 'index') {
      documentCount = 0;
      vectors = [];
      embedder ??= await pipeline(
        'feature-extraction',
        EMBEDDING_MODEL.id,
        options(EMBEDDING_MODEL, id),
      );
      for (let i = 0; i < payload.documents.length; i += RETRIEVAL.batchSize) {
        const batch = payload.documents.slice(i, i + RETRIEVAL.batchSize);
        const output = await embedder(batch, {
          pooling: 'mean',
          normalize: true,
          truncation: true,
          max_length: RETRIEVAL.documentTokens,
        });
        vectors.push(...output.tolist());
        progress(
          id,
          `Embedding matched records: ${vectors.length.toLocaleString()} / ${payload.documents.length.toLocaleString()}`,
        );
      }
      documentCount = payload.documents.length;
      self.postMessage({
        id,
        type: 'result',
        result: { count: vectors.length, dimensions: vectors[0]?.length ?? 384 },
      });
    } else if (operation === 'score') {
      if (!embedder || vectors.length !== documentCount)
        throw new Error('Prepare the local search index first.');
      if (!vectors.length) {
        self.postMessage({ id, type: 'result', result: [] });
        return;
      }
      const query = await embedder(payload.query, {
        pooling: 'mean',
        normalize: true,
        truncation: true,
        max_length: RETRIEVAL.documentTokens,
      });
      const queryVector = query.tolist()[0];
      // Unordered full-pool scores let callers combine fields before any cutoff.
      const result = vectors.map((vector, index) => ({
        index,
        similarity: cosineSimilarity(queryVector, vector),
      }));
      self.postMessage({ id, type: 'result', result });
    } else throw new Error('Unknown local search operation.');
  } catch (error) {
    self.postMessage({
      id,
      type: 'error',
      message: error.message || 'Local search inference failed.',
    });
  }
};
