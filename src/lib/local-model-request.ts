import type { Generation, ModelProfile, ModelMessage, ModelRequest, ModelChunk } from './types.ts';
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
  };
}

export async function readCompletion(
  chunks: AsyncIterable<ModelChunk>,
  onProgress?: (progress: {
    finishReason: ModelChunk['choices'][number]['finish_reason'];
    usage: ModelChunk['usage'];
  }) => void,
) {
  let raw = '';
  let finishReason;
  let usage;
  for await (const chunk of chunks) {
    const choice = chunk.choices?.[0];
    raw += choice?.delta?.content ?? '';
    finishReason = choice?.finish_reason ?? finishReason;
    usage = chunk.usage ?? usage;
    onProgress?.({ finishReason, usage });
  }
  return { raw, finishReason, usage };
}
