// Official MLC conversion, paired with the pinned WebLLM catalog's Qwen2 WASM.
// https://huggingface.co/mlc-ai/DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC/blob/main/mlc-chat-config.json
// Sampling: https://huggingface.co/deepseek-ai/DeepSeek-R1#usage-recommendations
// WebLLM's enable_thinking switch is documented for Qwen3, not this R1 model.
export const deepseekR1Qwen = Object.freeze({
  id: 'deepseek-r1-qwen-7b',
  modelId: 'DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC',
  label: 'DeepSeek R1 Distill Qwen 7B',
  shortLabel: 'DeepSeek R1 Qwen 7B',
  contextWindowTokens: 131072,
  generation: Object.freeze({ temperature: 0.6, top_p: 0.95 }),
  note: 'Reasoning model: may include thinking text despite the answer-only prompt.',
});
