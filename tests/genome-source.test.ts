import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { chooseGenomeFile, identifyGenome, matchGenomeSource } from '../src/lib/genome-source.ts';

const header =
  '##fileformat=VCFv4.2\n##reference=GRCh38\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC\n';
const vcf = header + '9\t72694578\t.\tC\tT\t99\tPASS\t.\tGT\t0/1\n';
const candidates = [
  {
    citation: 'C1',
    rowNumber: 1,
    chrom: '9',
    pos: 72694578,
    ref: 'C',
    alt: 'T',
    gene: 'TMC1',
    stars: 2,
  },
];

test('picker accepts one VCF with optional index companions; rejects ambiguous or unsupported selections', () => {
  const file = new File([vcf], 'synthetic.vcf.gz');
  assert.equal(chooseGenomeFile([file]), file);
  assert.equal(
    chooseGenomeFile([file, { name: file.name + '.tbi' }, { name: file.name + '.csi' }]),
    file,
  );
  for (const files of [
    [],
    [file, file],
    [{ name: 'sample.bam' }],
    [file, { name: 'unrelated.txt' }],
    [{ name: file.name + '.tbi' }],
  ])
    assert.throws(() => chooseGenomeFile(files), /Choose one/);
});

test('plain and compressed uploads match entirely from the browser File, without fetching or uploading', async () => {
  for (const [name, bytes] of [
    ['synthetic.vcf', Buffer.from(vcf)],
    ['synthetic.vcf.gz', gzipSync(vcf)],
  ] as [string, Buffer<ArrayBuffer>][]) {
    const file = new File([bytes], name);
    const genome = await identifyGenome(file);
    assert.equal(genome.cacheKey, createHash('sha256').update(bytes).digest('hex'));
    const result = await matchGenomeSource({
      file,
      genome,
      candidates,
      fetchImpl: () => {
        throw new Error('Personal files must not make network requests');
      },
    });
    assert.equal(result.matches.length, 1);
    assert.deepEqual(result.matches[0]!.call.alleles, ['C', 'T']);
    assert.equal(result.matches[0]!.call.copies, 1);
  }
});

test('same filename, size and modification date cannot reuse another genome’s identity', async () => {
  const a = new File([vcf], 'same.vcf', { lastModified: 1 });
  const b = new File([vcf.replace('0/1', '1/1')], 'same.vcf', { lastModified: 1 });
  assert.equal(a.size, b.size);
  const ga = await identifyGenome(a);
  const gb = await identifyGenome(b);
  assert.notEqual(ga.cacheKey, gb.cacheKey);
  await assert.rejects(matchGenomeSource({ file: b, genome: ga, candidates }), /integrity/);
});

test('invalid input, wrong builds, multiple samples, corrupt gzip and cancellation cannot produce usable matches', async () => {
  for (const value of ['', vcf.replace('GRCh38', 'GRCh37'), vcf.replace('SYNTHETIC\n', 'A\tB\n')]) {
    await assert.rejects(identifyGenome(new File([value], 'invalid.vcf')));
  }
  const file = new File([vcf], 'synthetic.vcf');
  const genome = await identifyGenome(file);
  await assert.rejects(matchGenomeSource({ genome, candidates }), /Choose your/);
  const stopped = AbortSignal.abort();
  await assert.rejects(identifyGenome(file, { signal: stopped }), { name: 'AbortError' });
  await assert.rejects(matchGenomeSource({ file, genome, signal: stopped }), {
    name: 'AbortError',
  });
  await assert.rejects(
    matchGenomeSource({
      // @ts-expect-error Unknown genome sources are rejected at runtime.
      genome: { kind: 'remote', url: 'https://not-allowed.example' },
      fetchImpl: () => {
        throw new Error('Must not fetch arbitrary input');
      },
    }),
    /Unknown genome/,
  );
  const truncated = gzipSync(vcf).subarray(0, -9);
  const bad = new File([truncated], 'bad.vcf.gz');
  await assert.rejects(
    matchGenomeSource({
      file: bad,
      genome: {
        kind: 'upload',
        available: true,
        name: bad.name,
        label: bad.name,
        bytes: bad.size,
        sha256: createHash('sha256').update(truncated).digest('hex'),
      },
    }),
    /gzip/,
  );
});
