import type { MatchResult, GenomeSource, SearchPlan } from '../src/lib/types.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { scanVcf } from '../src/lib/vcf-matcher.ts';
import { hydrateGenomewalkMatches } from '../src/lib/local-catalog.ts';
import { buildEmbeddingsContext } from '../src/lib/embeddings-context.ts';
import { buildGeneralContext } from '../src/lib/general-context.ts';
import { buildAnswerReference } from '../src/lib/evidence-answer.ts';
import { EXAMPLE_GENOME } from '../src/config/example-genome.ts';
import { LOCAL_MODELS } from '../src/config/models/index.ts';

const fields = [
  'chrom',
  'pos',
  'ref',
  'alt',
  'gene',
  'variationid',
  'stars',
  'sig',
  'classification',
  'conditions',
];
// Public catalog alleles; the uploaded-call fixture below is synthetic.
const annotations: [string, number, string, string, ...string[]][] = [
  [
    '1',
    241500602,
    'T',
    'TGAGA',
    'FH',
    '296866',
    '1',
    'C',
    'Conflicting_classifications_of_pathogenicity',
    'Hereditary_cancer-predisposing_syndrome',
  ],
  [
    '1',
    241500602,
    'T',
    'TGAGAGA',
    'FH',
    '296867',
    '1',
    'C',
    'Conflicting_classifications_of_pathogenicity',
    'Hereditary_cancer-predisposing_syndrome',
  ],
  [
    '15',
    34342117,
    'G',
    'A',
    'NOP10',
    '315637',
    '1',
    'C',
    'Conflicting_classifications_of_pathogenicity',
    'Hereditary_cancer-predisposing_syndrome',
  ],
];
const candidates = annotations.map((row, i) => ({
  chrom: row[0]!,
  pos: row[1]!,
  ref: row[2]!,
  alt: row[3]!,
  citation: `C${i + 1}`,
  rowNumber: i + 2,
}));
const catalogue = {
  header: '#' + fields.join('\t'),
  async *rows() {
    for (const row of annotations) yield row.join('\t');
  },
};
const header =
  '##fileformat=VCFv4.2\n##reference=GRCh38\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC\n';
const vcf = (chrom: string, pos: number, ref: string, alt: string, gt: string) =>
  `${chrom}\t${pos}\t.\t${ref}\t${alt}\t99\tPASS\t.\tGT\t${gt}\n`;
async function matched(lines: string) {
  const result = await scanVcf({
    candidates,
    chunks: (async function* () {
      yield Buffer.from(header + lines);
    })(),
  });
  return hydrateGenomewalkMatches(result, catalogue);
}
const plan: SearchPlan = { mode: 'search', query: 'cancer-related variants' };
test('follow-up includes public-example provenance but no source records or file identity', () => {
  const previous = [{ question: 'Earlier question', answer: 'Earlier answer' }];
  const c = buildGeneralContext('Explain it', previous, LOCAL_MODELS[0]!, {
    followup: true,
    genomeSource: EXAMPLE_GENOME,
  });
  const payload = JSON.parse(c.messages.at(-1)!.content);
  assert.deepEqual(payload.genomeSource, { kind: 'example', label: EXAMPLE_GENOME.label });
  assert.equal(payload.reference, undefined);
  assert.equal(c.historyTurns, 1);
  assert.ok(!JSON.stringify(c.messages).includes(EXAMPLE_GENOME.sha256));
  assert.ok(!JSON.stringify(c.messages).includes(EXAMPLE_GENOME.name));
});
const contextFor = (
  result: MatchResult,
  genomeSource: Pick<GenomeSource, 'kind' | 'label'> & Partial<GenomeSource>,
) =>
  buildEmbeddingsContext(
    'Cancer-related variants?',
    result.matches,
    result,
    LOCAL_MODELS[0]!,
    plan,
    { genomeSource: { available: true, name: 'Synthetic fixture', bytes: 1, ...genomeSource } },
  );

test('same-position FH alleles stay distinct through matching, annotation hydration, context and rendered links; absent NOP10 stays absent', async () => {
  const result = await matched(vcf('chr1', 241500602, 'T', 'TGAGA', '0/1'));
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]!.variationid, '296866');
  assert.deepEqual(result.matches[0]!.call.alleles, ['T', 'TGAGA']);
  const context = contextFor(result, {
    kind: 'upload',
    name: 'PRIVATE_FILENAME',
    label: 'PRIVATE_FILENAME',
    sha256: 'PRIVATE_DIGEST',
  });
  const request = JSON.stringify(context.messages);
  assert.ok(!request.includes('PRIVATE_'));
  assert.ok(!request.includes('TGAGAGA'));
  assert.ok(!request.includes('NOP10'));
  const rendered = JSON.stringify(buildAnswerReference(context.recordReference));
  assert.doesNotMatch(rendered, /These results are from/);
  assert.match(rendered, /selected file contains T and TGAGA/);
  assert.match(
    context.recordReference.records[0]!.fields.find((f) => f.label === 'ClinVar classification')!
      .sources[0]!.url,
    /296866\/$/,
  );
});

test('public HG002 calls are labeled as example evidence throughout the answer request', async () => {
  const result = await matched(
    vcf('chr1', 241500602, 'T', 'TGAGAGA', '1/1') + vcf('chr15', 34342117, 'G', 'A', '0/1'),
  );
  assert.deepEqual(
    result.matches.map((r) => r.variationid),
    ['296867', '315637'],
  );
  assert.deepEqual(
    result.matches.map((r) => r.call.copies),
    [2, 1],
  );
  for (const profile of LOCAL_MODELS) {
    const context = buildEmbeddingsContext(
      'Cancer-related variants?',
      result.matches,
      result,
      profile,
      plan,
      { genomeSource: EXAMPLE_GENOME },
    );
    assert.deepEqual(JSON.parse(context.messages[1]!.content).reference.genomeSource, {
      kind: 'example',
      label: EXAMPLE_GENOME.label,
    });
    assert.ok(!JSON.stringify(context.messages).includes(EXAMPLE_GENOME.sha256));
    assert.ok(!JSON.stringify(context.messages).includes(EXAMPLE_GENOME.name));
    const rendered = JSON.stringify(buildAnswerReference(context.recordReference));
    assert.deepEqual(buildAnswerReference(context.recordReference).genomeSource, {
      kind: 'example',
      label: EXAMPLE_GENOME.label,
    });
    assert.match(rendered, /selected file contains TGAGAGA and TGAGAGA/);
    assert.match(rendered, /selected file contains G and A/);
    assert.doesNotMatch(rendered, /your file|Your file/);
  }
});

test('a multiallelic FH site lists both alleles but only the called allele enters retrieval', async () => {
  const result = await matched(
    vcf('1', 241500602, 'T', 'TGAGA,TGAGAGA', '0/1') + vcf('15', 34342117, 'G', 'A', '0/0'),
  );
  assert.deepEqual(
    result.matches.map((r) => r.variationid),
    ['296866'],
  );
  assert.equal(result.stats.explicitlyNotCarried, 2);
});
