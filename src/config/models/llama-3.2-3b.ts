import type { ModelProfile } from '../../lib/types.ts';
// Official MLC conversion; tokenizer, template and WASM come from WebLLM.
// Native context and sampling defaults:
// https://huggingface.co/mlc-ai/Llama-3.2-3B-Instruct-q4f16_1-MLC/blob/main/mlc-chat-config.json
export const llama32_3b: ModelProfile = Object.freeze({
  id: 'llama-3.2-3b',
  modelId: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
  label: 'Llama 3.2 3B Instruct',
  shortLabel: 'Llama 3.2 3B',
  contextWindowTokens: 131072,
  generation: Object.freeze({ temperature: 0.6, top_p: 0.9 }),
});
