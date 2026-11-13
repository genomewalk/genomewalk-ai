// Official MLC conversion, paired with the pinned WebLLM catalog's Llama3.1 WASM.
// https://huggingface.co/mlc-ai/DeepSeek-R1-Distill-Llama-8B-q4f16_1-MLC/blob/main/mlc-chat-config.json
// Sampling: https://huggingface.co/deepseek-ai/DeepSeek-R1#usage-recommendations
// Retain the same shared prompts; do not fake a non-thinking runtime switch.
export const deepseekR1Llama = Object.freeze({
  id: 'deepseek-r1-llama-8b',
  modelId: 'DeepSeek-R1-Distill-Llama-8B-q4f16_1-MLC',
  label: 'DeepSeek R1 Distill Llama 8B',
  shortLabel: 'DeepSeek R1 Llama 8B',
  contextWindowTokens: 131072,
  generation: Object.freeze({ temperature: 0.6, top_p: 0.95 }),
  note: 'Reasoning model: may include thinking text despite the answer-only prompt.',
});
