// Dedicated CPU/WASM worker avoids competing with the answer model's GPU cache.
export class EmbeddingsClient {
  constructor({
    workerFactory = () =>
      new Worker(new URL('./embeddings.worker.js', import.meta.url), { type: 'module' }),
  } = {}) {
    this.workerFactory = workerFactory;
    this.worker = null;
    this.nextId = 0;
    this.pending = new Map();
    this.hasIndex = false;
  }
  call(operation, payload, { signal, onProgress = () => {} } = {}) {
    signal?.throwIfAborted();
    if (!this.worker) {
      this.worker = this.workerFactory();
      this.worker.onmessage = ({ data }) => {
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
    return new Promise((resolve, reject) => {
      const abort = () => this.dispose(new DOMException('Stopped', 'AbortError'));
      const cleanup = () => {
        signal?.removeEventListener('abort', abort);
        this.pending.delete(id);
      };
      if (operation === 'index') this.hasIndex = false;
      this.pending.set(id, { resolve, reject, cleanup, onProgress, operation });
      signal?.addEventListener('abort', abort, { once: true });
      this.worker.postMessage({ id, operation, payload });
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
