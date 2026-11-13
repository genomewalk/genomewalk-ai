import type { ModelProfile } from '../../lib/types.ts';
// Official MLC conversion of Meta Llama 3.1 8B Instruct. WebLLM supplies the
// matching tokenizer, conversation template and compiled WebGPU library.
// https://huggingface.co/mlc-ai/Llama-3.1-8B-Instruct-q4f16_1-MLC/blob/main/mlc-chat-config.json
export const llama31: ModelProfile = Object.freeze({
  id: 'llama-3.1-8b',
  modelId: 'Llama-3.1-8B-Instruct-q4f16_1-MLC',
  label: 'Llama 3.1 8B Instruct',
  shortLabel: 'Llama 3.1 8B',
  contextWindowTokens: 131072,
  generation: Object.freeze({ temperature: 0.6, top_p: 0.9 }),
});
