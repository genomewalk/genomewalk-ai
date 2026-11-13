import type { ModelProfile, ModelMessage, ModelRequest } from './types.ts';
// A fresh standard WebLLM request for both ordinary chat and private inference.
// Model-specific options never carry over from the previously selected model.
export function localModelRequest(profile: ModelProfile, messages: ModelMessage[]): ModelRequest {
  return {
    model: profile.modelId,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...profile.generation,
    max_tokens: profile.contextWindowTokens,
    ...(profile.extraBody ? { extra_body: { ...profile.extraBody } } : {}),
  };
}
