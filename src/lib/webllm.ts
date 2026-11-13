import type { EngineOptions, ModelEngine, ModelRequest } from './types.ts';
import { CreateWebWorkerMLCEngine, prebuiltAppConfig } from '@mlc-ai/web-llm';

// Use the weights AND compiled WASM paired by the installed WebLLM release.
export async function createLocalEngine({
  profile,
  onProgress,
  onFatal,
}: EngineOptions): Promise<ModelEngine> {
  const model = prebuiltAppConfig.model_list.find((entry) => entry.model_id === profile.modelId);
  if (!model) throw new Error(`The installed WebLLM release does not support ${profile.modelId}.`);

  const worker = new Worker(new URL('webllm.worker.ts', import.meta.url), { type: 'module' });
  let rejectFailure!: (error: Error) => void;
  const failure = new Promise<never>((_, reject) => {
    rejectFailure = reject;
  });
  // Also handle an idle worker failing when there is no RPC waiting on it.
  failure.catch(() => {});
  const fail = (event: Event) => {
    const error = new Error(
      ('message' in event && String(event.message)) ||
        'The local model worker stopped unexpectedly. Reload the model to continue.',
    );
    rejectFailure(error);
    onFatal(error);
    worker.terminate();
  };
  worker.addEventListener('error', fail);
  worker.addEventListener('messageerror', fail);
  const guard = <T>(operation: Promise<T>): Promise<T> => Promise.race([operation, failure]);
  const dispose = () => {
    worker.removeEventListener('error', fail);
    worker.removeEventListener('messageerror', fail);
    rejectFailure(new Error('The local model was unloaded.'));
    worker.terminate();
  };

  try {
    const engine = await guard(
      CreateWebWorkerMLCEngine(
        worker,
        profile.modelId,
        {
          initProgressCallback: onProgress,
          appConfig: { ...prebuiltAppConfig, model_list: [model] },
          logLevel: 'WARN',
        },
        { context_window_size: profile.contextWindowTokens },
      ),
    );
    return {
      async *complete(request: ModelRequest) {
        const stream = await guard(engine.chat.completions.create(request));
        const iterator = stream[Symbol.asyncIterator]();
        try {
          while (true) {
            const result = await guard(iterator.next());
            if (result.done) break;
            yield result.value;
          }
        } finally {
          if (iterator.return) await guard(iterator.return());
        }
      },
      reset: () => guard(engine.resetChat()),
      interrupt: () => engine.interruptGenerate(),
      unload: () => guard(engine.unload()),
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
