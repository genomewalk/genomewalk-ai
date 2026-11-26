import type {
  PreTrainedModel,
  PreTrainedTokenizer,
  PretrainedModelOptions,
} from '@huggingface/transformers';
import type { SearchOperation } from './worker-protocol.ts';
import { AutoModel, AutoTokenizer, env } from '@huggingface/transformers';
import wasmURL from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';
import wasmModuleURL from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url';
import { EMBEDDING_MODEL, RETRIEVAL } from '../config/embeddings.ts';
import { colbertInputs, colbertVectors, maxSim } from './colbert.ts';

env.allowLocalModels = false;
env.useBrowserCache = true; // Public model assets only. No personal index persistence.
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.wasmPaths = { wasm: wasmURL, mjs: wasmModuleURL };
let model: PreTrainedModel | undefined;
let tokenizer: PreTrainedTokenizer | undefined;
let documentCount = -1;
let vectors: Float32Array[] = [];
const progress = (id: number, message: string) =>
  self.postMessage({ id, type: 'progress', message });
const options = (model: typeof EMBEDDING_MODEL, id: number): PretrainedModelOptions => ({
  ...model,
  progress_callback: (event) => {
    if (event.status === 'progress')
      progress(
        id,
        `Loading ${model.id.split('/').at(-1)} · ${Math.round(event.progress ?? 0)}% of ${event.file}`,
      );
  },
});

async function encode(texts: string[], kind: 'query' | 'document') {
  if (!model || !tokenizer) throw new Error('Load the local search model first.');
  const { inputs, masks } = colbertInputs(tokenizer, texts, kind);
  const output = await model(inputs);
  return colbertVectors(output.output, masks);
}

self.onmessage = async ({ data: { id, operation, payload } }: MessageEvent<SearchOperation>) => {
  try {
    if (operation === 'index') {
      documentCount = -1;
      vectors = [];
      tokenizer ??= await AutoTokenizer.from_pretrained(
        EMBEDDING_MODEL.id,
        options(EMBEDDING_MODEL, id),
      );
      model ??= await AutoModel.from_pretrained(EMBEDDING_MODEL.id, options(EMBEDDING_MODEL, id));
      for (let i = 0; i < payload.documents.length; i += RETRIEVAL.batchSize) {
        const batch = payload.documents.slice(i, i + RETRIEVAL.batchSize);
        vectors.push(...(await encode(batch, 'document')));
        progress(
          id,
          `Embedding matched records: ${vectors.length.toLocaleString()} / ${payload.documents.length.toLocaleString()}`,
        );
      }
      documentCount = payload.documents.length;
      self.postMessage({
        id,
        type: 'result',
        result: { count: vectors.length, dimensions: RETRIEVAL.dimensions },
      });
    } else if (operation === 'score') {
      if (!model || vectors.length !== documentCount)
        throw new Error('Prepare the local search index first.');
      if (!vectors.length) {
        self.postMessage({ id, type: 'result', result: [] });
        return;
      }
      const [query] = await encode([payload.query], 'query');
      // Native ColBERT MaxSim over the entire pool, without lexical/field bonuses.
      const result = vectors.map((vector, index) => ({
        index,
        similarity: maxSim(query!, vector, RETRIEVAL.dimensions),
      }));
      self.postMessage({ id, type: 'result', result });
    } else throw new Error('Unknown local search operation.');
  } catch (error) {
    self.postMessage({
      id,
      type: 'error',
      message: error instanceof Error ? error.message : 'Local search inference failed.',
    });
  }
};
