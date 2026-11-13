import type { SearchOperations, SearchClient, TextProgressOptions } from './types.ts';
import type { SearchReply } from './worker-protocol.ts';

interface Pending {
  operation: keyof SearchOperations;
  resolve: (result: SearchOperations[keyof SearchOperations]['output']) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
  onProgress: (message: string) => void;
}
// Dedicated CPU/WASM worker avoids competing with the answer model's GPU cache.
export class EmbeddingsClient implements SearchClient {
  workerFactory: () => Worker;
  worker: Worker | null;
  nextId: number;
  pending: Map<number, Pending>;
  hasIndex: boolean;
  constructor({
    workerFactory = () =>
      new Worker(new URL('embeddings.worker.ts', import.meta.url), { type: 'module' }),
  } = {}) {
    this.workerFactory = workerFactory;
    this.worker = null;
    this.nextId = 0;
    this.pending = new Map();
    this.hasIndex = false;
  }
  call<K extends keyof SearchOperations>(
    operation: K,
    payload: SearchOperations[K]['input'],
    { signal, onProgress = () => {} }: TextProgressOptions = {},
  ): Promise<SearchOperations[K]['output']> {
    signal?.throwIfAborted();
    if (!this.worker) {
      this.worker = this.workerFactory();
      this.worker.onmessage = ({ data }: MessageEvent<SearchReply>) => {
        const request = this.pending.get(data.id);
        if (!request) return;
        if (data.type === 'progress') request.onProgress(data.message);
        else {
          if (request.operation === 'index') this.hasIndex = data.type === 'result';
          request.cleanup();
          if (data.type === 'result') request.resolve(data.result);
          else request.reject(new Error(data.message));
        }
      };
      this.worker.onerror = () =>
        this.dispose(new Error('The local embedding worker stopped. Prepare the index again.'));
    }
    const id = ++this.nextId;
    return new Promise<SearchOperations[K]['output']>((resolve, reject) => {
      const abort = () => this.dispose(new DOMException('Stopped', 'AbortError'));
      const cleanup = () => {
        signal?.removeEventListener('abort', abort);
        this.pending.delete(id);
      };
      if (operation === 'index') this.hasIndex = false;
      // The request ID binds the reply to this operation's result type.
      this.pending.set(id, {
        resolve: (result) => resolve(result as SearchOperations[K]['output']),
        reject,
        cleanup,
        onProgress,
        operation,
      });
      signal?.addEventListener('abort', abort, { once: true });
      this.worker!.postMessage({ id, operation, payload });
    });
  }
  dispose(error = new Error('Local search index cleared.')) {
    this.worker?.terminate();
    this.worker = null;
    this.hasIndex = false;
    for (const request of [...this.pending.values()]) {
      request.cleanup();
      request.reject(error);
    }
  }
}
