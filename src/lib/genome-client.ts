import type { GenomeConfig, GenomeSource, MatchResult, ProgressOptions } from './types.ts';
import type { MatchGenomeOptions } from './genome-source.ts';
import type { GenomeOperation, GenomeReply } from './worker-protocol.ts';
export type MatchLocalOptions = Omit<MatchGenomeOptions, 'genome' | 'fetchImpl'> & {
  config: GenomeConfig;
};

function requestGenome(
  request: Extract<GenomeOperation, { operation: 'identify' }> & ProgressOptions,
): Promise<GenomeSource>;
function requestGenome(
  request: Extract<GenomeOperation, { operation: 'match' }> & ProgressOptions,
): Promise<MatchResult>;
function requestGenome({
  signal,
  onProgress = () => {},
  ...request
}: GenomeOperation & ProgressOptions): Promise<GenomeSource | MatchResult> {
  signal?.throwIfAborted();
  const worker = new Worker(new URL('genome.worker.ts', import.meta.url), { type: 'module' });
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
    worker.onmessage = ({ data }: MessageEvent<GenomeReply>) => {
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
    worker.postMessage(request);
  });
}
export function matchLocalGenome({
  config,
  file,
  candidates = [],
  lookup,
  signal,
  onProgress,
}: MatchLocalOptions) {
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
export function identifyLocalGenome(file: File, options: ProgressOptions = {}) {
  return requestGenome({ operation: 'identify', file, ...options });
}
