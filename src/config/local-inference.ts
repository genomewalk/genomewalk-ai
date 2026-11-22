import type { ModelProfile } from '../lib/types.ts';
// Reset the sampling seed on every request, independent of earlier questions.
// Reproducibility is best effort within the same model, runtime and device.
export const LOCAL_SAMPLING = Object.freeze({ temperature: 0, top_p: 1, seed: 42 });

// Shared context budgets for the local workflow.
export const LOCAL_MIN_RESPONSE_TOKENS = 4096;
export const LOCAL_TEMPLATE_RESERVE_TOKENS = 256;

export function localContextBudget(profile: ModelProfile) {
  return {
    contextWindowTokens: profile.contextWindowTokens,
    // The runtime counts the actual tokenized prompt and enforces the remaining
    // context boundary. There is no smaller, arbitrary response-length cap.
    responseTokenLimit: profile.contextWindowTokens,
    minimumResponseTokens: LOCAL_MIN_RESPONSE_TOKENS,
    inputByteLimit:
      profile.contextWindowTokens - LOCAL_MIN_RESPONSE_TOKENS - LOCAL_TEMPLATE_RESERVE_TOKENS,
  };
}
