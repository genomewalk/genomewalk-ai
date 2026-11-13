import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { scanVcf } from './vcf-matcher.js';
import { openConsumerGenome, matchConsumerGenome } from './consumer-matcher.js';
import { EXAMPLE_GENOME } from '../config/example-genome.js';
import { publicFile } from './public-files.js';

// Same single-file/optional companion-index intake rule as Genomewalk.
export function chooseGenomeFile(files) {
  const list = Array.from(files);
  const genomes = list.filter((file) => /\.(?:vcf(?:\.gz)?|txt(?:\.gz)?|zip)$/i.test(file.name));
  if (
    genomes.length === 1 &&
    list.every(
      (file) =>
        file === genomes[0] ||
        (/\.vcf(?:\.gz)?$/i.test(genomes[0].name) &&
          [`${genomes[0].name}.tbi`, `${genomes[0].name}.csi`].includes(file.name)),
    )
  )
    return genomes[0];
  throw new Error(
    'Choose one GRCh38 VCF (.vcf or .vcf.gz), or an original 23andMe or AncestryDNA export (.txt, .txt.gz or .zip). A VCF index may accompany its file.',
  );
}

async function* chunks(stream, signal) {
  const reader = stream.getReader();
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function identifyGenome(file, { signal, onProgress = () => {} } = {}) {
  chooseGenomeFile([file]);
  if (!file.size) throw new Error('This genome file is empty.');
  // Extension chooses the reader; the actual header must validate that format.
  const consumer = !/\.vcf(?:\.gz)?$/i.test(file.name);
  const source = consumer
    ? await openConsumerGenome(file, signal)
    : await scanVcf({ chunks: chunks(file.stream(), signal), headerOnly: true, signal });
  const profile = consumer
    ? {
        format: 'consumer',
        build: source.build,
        provider: source.provider,
        strand: source.strand,
        buildSource: source.buildSource,
        strandSource: source.strandSource,
      }
    : { format: 'vcf', build: source.build };
  const hash = sha256.create();
  let bytes = 0;
  for await (const chunk of chunks(file.stream(), signal)) {
    hash.update(chunk);
    bytes += chunk.length;
    onProgress({ bytes, records: 0 });
  }
  signal?.throwIfAborted();
  if (bytes !== file.size)
    throw new Error('The selected file changed while being read. Choose it again.');
  const digest = bytesToHex(hash.digest());
  return {
    kind: 'upload',
    available: true,
    name: file.name,
    label: file.name,
    ...profile,
    bytes,
    sha256: digest,
    cacheKey: digest,
  };
}

export async function matchGenomeSource({
  genome,
  file,
  candidates = [],
  lookup = null,
  signal,
  onProgress = () => {},
  fetchImpl = fetch,
}) {
  signal?.throwIfAborted();
  let stream;
  if (genome.kind === 'upload') {
    if (!file || file.size !== genome.bytes)
      throw new Error('Choose your local genome file again.');
    stream = file.stream(); // No network request is made for a selected File.
  } else if (genome.kind === 'example' && genome.sha256 === EXAMPLE_GENOME.sha256) {
    const response = await fetchImpl(publicFile(`/samples/${EXAMPLE_GENOME.name}`), { signal });
    if (!response.ok || !response.body)
      throw new Error(
        'The public GIAB example could not be loaded. Retry or choose your own GRCh38 VCF.',
      );
    if (Number(response.headers.get('Content-Length')) !== genome.bytes)
      throw new Error('The GIAB example has an unexpected size.');
    stream = response.body;
  } else throw new Error('Unknown genome source.');
  const hash = sha256.create();
  let bytes = 0;
  const verified = (async function* () {
    for await (const chunk of chunks(stream, signal)) {
      hash.update(chunk);
      bytes += chunk.length;
      yield chunk;
    }
  })();
  let result;
  if (genome.format === 'consumer') {
    if (!lookup || lookup.build !== genome.build)
      throw new Error('The public rsID reference must match the DNA export’s genome build.');
    for await (const _chunk of verified) {
      signal?.throwIfAborted();
    }
    const source = await openConsumerGenome(file, signal);
    if (source.build !== genome.build || source.provider !== genome.provider)
      throw new Error('The selected DNA export changed. Choose it again.');
    result = await matchConsumerGenome({ source, candidates, lookup, signal, onProgress });
  } else result = await scanVcf({ chunks: verified, candidates, signal, onProgress });
  signal?.throwIfAborted();
  if (bytes !== genome.bytes || bytesToHex(hash.digest()) !== genome.sha256)
    throw new Error(
      'The genome failed its integrity check. No matches were used. Choose the file again or retry the example.',
    );
  return result;
}
