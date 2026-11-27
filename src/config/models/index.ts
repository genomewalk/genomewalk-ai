import { llama31 } from './llama-3.1-8b.ts';
import { llama32_1b } from './llama-3.2-1b.ts';
import { llama32_3b } from './llama-3.2-3b.ts';
import { qwen3 } from './qwen3-4b.ts';
import { qwen35 } from './qwen3.5-9b.ts';
import { deepseekR1Qwen } from './deepseek-r1-qwen-7b.ts';
import { deepseekR1Llama } from './deepseek-r1-llama-8b.ts';

// Built-in profiles. A user can add others from a Hugging Face link (src/lib/custom-models.ts).
// Every modelId must exist in the pinned WebLLM release's prebuilt catalog.
// Listed from the least to the most memory needed.
export const LOCAL_MODELS = Object.freeze([
  llama32_1b,
  llama32_3b,
  qwen3,
  llama31,
  deepseekR1Llama,
  deepseekR1Qwen,
  qwen35,
]);
const DEFAULT_MODEL_ID = llama31.id;
export function getModelProfile(id = DEFAULT_MODEL_ID) {
  const profile = LOCAL_MODELS.find((model) => model.id === id);
  if (!profile) throw new Error(`Unknown local model profile: ${id}`);
  return profile;
}
