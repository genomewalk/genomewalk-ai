import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { scanVcf } from '../src/lib/vcf-matcher.ts';

const header =
  '##fileformat=VCFv4.2\n##reference=GRCh38.p13\n##contig=<ID=1,length=248956422>\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC\n';
const candidate = (extra = {}) => ({
  citation: 'C1',
  rowNumber: 2,
  chrom: '1',
  pos: 10,
  ref: 'G',
  alt: 'A',
  gene: 'TEST',
  stars: 2,
  classification: 'Pathogenic',
  ...extra,
});
const row = (
  alt: string,
  gt: string,
  filter = 'PASS',
  format = 'GT:DP:GQ',
  sample = `${gt}:30:99`,
) => `chr1\t10\t.\tG\t${alt}\t99\t${filter}\t.\t${format}\t${sample}\n`;
async function* chunks(bytes: Uint8Array, size = 31) {
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
}
const run = (text: string, candidates = [candidate()], options = {}) =>
  scanVcf({ chunks: chunks(Buffer.from(text)), candidates, ...options });

test('matches exact GRCh38 alleles with FORMAT-aware, multiallelic and phased GT parsing', async () => {
  const result = await run(header + row('A,T', '2|0', 'PASS', 'DP:GT:GQ', '45:2|0:70'), [
    candidate(),
    candidate({ citation: 'C2', alt: 'T' }),
  ]);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]!.alt, 'T');
  assert.equal(result.matches[0]!.call.copies, 1);
  assert.equal(result.matches[0]!.call.dp, 45);
  assert.equal(result.stats.explicitlyNotCarried, 1);
});

test('matched call quality preserves QUAL, FORMAT order and allele-indexed depths without the sample identifier', async () => {
  const result = await run(
    header + row('A,T', '2|0', 'PASS', 'AD:GQ:GT:DP:FT', '19,0,12:127:2|0:31:PASS'),
    [candidate({ alt: 'T' })],
  );
  const { call } = result.matches[0]!;
  assert.deepEqual(call.alleles, ['T', 'G']);
  assert.equal(call.copies, 1);
  assert.equal(call.qual, 99);
  assert.equal(call.gq, 127);
  assert.equal(call.dp, 31);
  assert.equal(call.sampleFilter, 'PASS');
  assert.deepEqual(call.alleleDepths, { alleles: ['G', 'A', 'T'], readCounts: [19, 0, 12] });
  assert.equal(call.sourceVcfFields!.format, 'AD:GQ:GT:DP:FT');
  assert.equal(call.sourceVcfFields!.sampleValues, '19,0,12:127:2|0:31:PASS');
  assert.ok(!JSON.stringify(call).includes('SYNTHETIC'));
  for (const ad of ['.', '10', '10,nope']) {
    const missing = await run(header + row('A', '0/1', 'PASS', 'GT:AD', `0/1:${ad}`));
    assert.equal(missing.matches[0]!.call.alleleDepths, null);
    assert.equal(missing.matches[0]!.call.dp, null);
  }
});

test('missing, filtered, and contradictory calls are withheld rather than interpreted', async () => {
  for (const data of [
    row('A', '1/.'),
    row('A', './.'),
    row('A', '0/1', 'LowQual'),
    row('A', '0/1') + row('A', '0/0'),
    row('A', '0/1') + row('A', './.'),
  ]) {
    const result = await run(header + data);
    assert.equal(result.matches.length, 0);
    assert.equal(result.issues.length, 1);
  }
  const reordered = await run(header + row('A,T', '0/1') + row('T,A', '2/0'));
  assert.equal(reordered.matches.length, 1);
  assert.equal(reordered.matches[0]!.recordCount, 2);
});

test('does not infer absent variants, normalize indels, or accept another build/sample count', async () => {
  assert.equal((await run(header + row('T', '0/1'))).stats.notObserved, 1);
  assert.equal(
    (await run(header + row('A', '0/1'), [candidate({ ref: 'GG', alt: 'G' })])).matches.length,
    0,
  );
  await assert.rejects(run(header.replace('GRCh38.p13', 'GRCh37') + row('A', '0/1')), /GRCh38/);
  await assert.rejects(
    run(
      header
        .replace('##reference=GRCh38.p13\n', '')
        .replace('##contig=<ID=1,length=248956422>\n', '') + row('A', '0/1'),
    ),
    /GRCh38/,
  );
  await assert.rejects(
    run(header.replace('SYNTHETIC\n', 'SYNTHETIC\tSECOND\n') + row('A', '0/1')),
    /single-sample/,
  );
  await assert.rejects(run(header + row('A', '0/1') + 'broken\n'), /Malformed VCF/);
});

test('gzip and concatenated members work across every-byte boundaries; bad CRC and truncation fail', async () => {
  const data = Buffer.concat([gzipSync(header), gzipSync(row('A', '1/1'))]);
  for (const size of [1, gzipSync(header).length, 65536]) {
    const result = await scanVcf({ chunks: chunks(data, size), candidates: [candidate()] });
    assert.equal(result.matches[0]!.call.copies, 2);
  }
  await assert.rejects(
    scanVcf({ chunks: chunks(data.subarray(0, -5)), candidates: [candidate()] }),
    /gzip/,
  );
  const corrupted = Buffer.from(data);
  corrupted[corrupted.length - 8]! ^= 1;
  await assert.rejects(scanVcf({ chunks: chunks(corrupted), candidates: [candidate()] }), /gzip/);
});

test('header preflight stops before personal records and cancellation discards provisional matches', async () => {
  const info = await run(header + 'invalid-not-read', [], { headerOnly: true });
  assert.deepEqual(info, { build: 'GRCh38', samples: 1 });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(run(header + row('A', '0/1'), [], { signal: controller.signal }), {
    name: 'AbortError',
  });
});

test('uses Genomewalk build detection for chromosome lengths and rejects conflicting headers', async () => {
  const columns = '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC\n';
  for (const meta of [
    '##contig=<ID=chr1,length=248956422>',
    '##contig=<length="242193529",ID="chr2">',
    '##genome_build=GRCh38',
  ]) {
    const result = await run(`##fileformat=VCFv4.2\n${meta}\n${columns}${row('A', '0/1')}`);
    assert.equal(result.matches.length, 1);
  }
  for (const meta of [
    '##contig=<ID=chr1,length=249250621>',
    '##reference=hg19\n##contig=<ID=chr1,length=248956422>',
    '##contig=<ID=chr1,length=248956422>\n##contig=<ID=chr2,length=243199373>',
    '##INFO=<ID=DB,Description="Annotations lifted to GRCh38">',
  ])
    await assert.rejects(
      run(`##fileformat=VCFv4.2\n${meta}\n${columns}${row('A', '0/1')}`),
      /GRCh38/,
    );
});

test('Genomewalk filter policy retains unfiltered calls without labeling them PASS', async () => {
  const result = await run(header + row('A', '0/1', '.'));
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]!.call.filter, '.');
  assert.equal(result.matches[0]!.call.sourceVcfFields!.filter, '.');
  const failed = await run(header + row('A', '0/1', '.', 'GT:FT', '0/1:LowQual'));
  assert.equal(failed.matches.length, 0);
  assert.equal(failed.issues.length, 1);
});
