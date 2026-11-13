import { identifyGenome, matchGenomeSource } from './genome-source.js';

self.onmessage = async ({ data }) => {
  try {
    let last = 0;
    const onProgress = (progress) => {
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
    self.postMessage({ type: 'error', message: error.message || 'Local genome matching failed.' });
  }
};
