// Shared context budgets for the local workflow.
export const LOCAL_MIN_RESPONSE_TOKENS = 4096;
export const LOCAL_TEMPLATE_RESERVE_TOKENS = 256;

export function localContextBudget(profile) {
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
