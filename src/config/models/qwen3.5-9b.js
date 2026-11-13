// Official MLC conversion; its native context is 262,144 tokens.
// https://huggingface.co/mlc-ai/Qwen3.5-9B-q4f16_1-MLC/blob/main/mlc-chat-config.json
// Use the WebLLM-supported subset of Qwen's non-thinking/general-task guidance:
// https://huggingface.co/Qwen/Qwen3.5-9B#best-practices
// The pinned WebLLM catalog supplies max_history_size and corrected stop IDs;
// retain those model-record overrides when loading this recurrent architecture.
export const qwen35 = Object.freeze({
  id: 'qwen3.5-9b',
  modelId: 'Qwen3.5-9B-q4f16_1-MLC',
  label: 'Qwen3.5 9B',
  shortLabel: 'Qwen3.5 9B',
  // Full native allocation lost the WebGPU device on the local test machine.
  // Keep the configured browser window explicit rather than silently retrying
  // smaller contexts. See VALIDATION.md for the tested settings.
  nativeContextWindowTokens: 262144,
  contextWindowTokens: 131072,
  generation: Object.freeze({
    temperature: 0.7,
    top_p: 0.8,
    presence_penalty: 1.5,
    repetition_penalty: 1.0,
  }),
  extraBody: Object.freeze({ enable_thinking: false }),
});
