import type { Generation, ModelProfile, ModelMessage, ModelRequest } from './types.ts';
import { LOCAL_SAMPLING } from '../config/local-inference.ts';
// A fresh standard WebLLM request for both ordinary chat and private inference.
// Model-specific options never carry over from the previously selected model.
export function localModelRequest(
  profile: ModelProfile,
  messages: ModelMessage[],
  generation: Generation = {},
): ModelRequest {
  return {
    model: profile.modelId,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...profile.generation,
    max_tokens: profile.contextWindowTokens,
    ...(profile.extraBody ? { extra_body: { ...profile.extraBody } } : {}),
    ...generation,
    // Use the same sampling policy for every model and inference stage.
    ...LOCAL_SAMPLING,
  };
}
