function requestGenome({
  operation,
  genome,
  file,
  candidates,
  lookup,
  signal,
  onProgress = () => {},
}) {
  signal?.throwIfAborted();
  const worker = new Worker(new URL('./genome.worker.js', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('Stopped', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') onProgress(data);
      if (data.type === 'result') {
        cleanup();
        resolve(data.result);
      }
      if (data.type === 'error') {
        cleanup();
        reject(new Error(data.message));
      }
    };
    worker.onerror = () => {
      cleanup();
      reject(new Error('The local genome worker stopped unexpectedly.'));
    };
    worker.postMessage({ operation, genome, file, candidates, lookup });
  });
}
export function matchLocalGenome({ config, file, candidates = [], lookup, signal, onProgress }) {
  return requestGenome({
    operation: 'match',
    genome: config.localGenome,
    file,
    candidates,
    lookup,
    signal,
    onProgress,
  });
}
export function identifyLocalGenome(file, options) {
  return requestGenome({ operation: 'identify', file, ...options });
}
