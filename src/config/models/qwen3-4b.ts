import type { ModelProfile } from '../../lib/types.ts';
// Qwen's non-thinking sampling guidance; presence penalty retained from the
// existing app configuration. These options affect generation, never output text.
// https://huggingface.co/Qwen/Qwen3-4B#best-practices
export const qwen3: ModelProfile = Object.freeze({
  id: 'qwen3-4b',
  modelId: 'Qwen3-4B-q4f16_1-MLC',
  label: 'Qwen3 4B',
  shortLabel: 'Qwen3 4B',
  contextWindowTokens: 32768,
  generation: Object.freeze({ temperature: 0.7, top_p: 0.8, presence_penalty: 1.5 }),
  extraBody: Object.freeze({ enable_thinking: false }),
});
