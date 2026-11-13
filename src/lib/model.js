import { getModelProfile } from '../config/models/index.js';

export async function checkWebGPU(environment = globalThis) {
  if (!environment.isSecureContext) {
    throw new Error('WebGPU needs a secure context. Open this app on localhost or HTTPS.');
  }
  if (!environment.navigator?.gpu) {
    throw new Error(
      'WebGPU is unavailable. Try a current Chrome or Edge browser with hardware acceleration enabled.',
    );
  }
  const adapter = await environment.navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) {
    throw new Error(
      'No WebGPU adapter is available. Check hardware acceleration and your GPU drivers, then reload.',
    );
  }
  if (!adapter.features.has('shader-f16')) {
    throw new Error(
      'This GPU does not support shader-f16, which the selected model requires. Try a compatible device or browser.',
    );
  }
  return 'WebGPU supported · float16';
}

export function explainError(error, profile = getModelProfile()) {
  const detail = error instanceof Error ? error.message : String(error);
  let message = detail;
  if (
    /out of memory|allocation|device.*lost|buffer.*size|buffer.*limit|external Instance reference|Object.*disposed/i.test(
      detail,
    )
  ) {
    message = `The GPU could not keep the model running. The model and its ${profile.contextWindowTokens.toLocaleString('en-US')}-token context need several GB of GPU memory plus browser overhead. Close other GPU-heavy tabs, then reload the model.`;
  } else if (/fetch|network|download|load failed/i.test(detail)) {
    message =
      'Model assets could not be downloaded. Check your connection and access to Hugging Face and GitHub, then try again. Cached downloads can be reused.';
  } else if (/context|prompt.*long|exceed.*token/i.test(detail)) {
    message = `This conversation may exceed the ${profile.contextWindowTokens.toLocaleString('en-US')}-token context window. Clear the conversation or try a shorter message.`;
  }
  return { message, detail: message === detail ? '' : detail };
}
