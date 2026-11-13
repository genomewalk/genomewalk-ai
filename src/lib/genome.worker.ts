import type { GenomeOperation } from './worker-protocol.ts';
import type { MatchProgress } from './types.ts';
import { identifyGenome, matchGenomeSource } from './genome-source.ts';

self.onmessage = async ({ data }: MessageEvent<GenomeOperation>) => {
  try {
    let last = 0;
    const onProgress = (progress: MatchProgress) => {
      if (performance.now() - last > 150) {
        last = performance.now();
        self.postMessage({ type: 'progress', ...progress });
      }
    };
    const result =
      data.operation === 'identify'
        ? await identifyGenome(data.file, { onProgress })
        : await matchGenomeSource({ ...data, onProgress });
    self.postMessage({ type: 'result', result });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Local genome matching failed.',
    });
  }
};
