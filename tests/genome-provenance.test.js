import test from 'node:test';
import assert from 'node:assert/strict';
import { scanVcf } from '../src/lib/vcf-matcher.js';
import { hydrateGenomewalkMatches } from '../src/lib/local-catalog.js';
import { buildEmbeddingsContext } from '../src/lib/embeddings-context.js';
import { renderRecordSelection } from '../src/lib/evidence-answer.js';
import { EXAMPLE_GENOME } from '../src/config/example-genome.js';
import { LOCAL_MODELS } from '../src/config/models/index.js';

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
const annotations = [
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
  chrom: row[0],
  pos: row[1],
  ref: row[2],
  alt: row[3],
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
const vcf = (chrom, pos, ref, alt, gt) =>
  `${chrom}\t${pos}\t.\t${ref}\t${alt}\t99\tPASS\t.\tGT\t${gt}\n`;
async function matched(lines) {
  const result = await scanVcf({
    candidates,
    chunks: (async function* () {
      yield Buffer.from(header + lines);
    })(),
  });
  return hydrateGenomewalkMatches(result, catalogue);
}
const plan = { mode: 'search', query: 'cancer-related variants' };
const contextFor = (result, genomeSource) =>
  buildEmbeddingsContext(
    'Cancer-related variants?',
    result.matches,
    result,
    LOCAL_MODELS[0],
    plan,
    [],
    { genomeSource },
  );

test('same-position FH alleles stay distinct through matching, annotation hydration, context and rendered links; absent NOP10 stays absent', async () => {
  const result = await matched(vcf('chr1', 241500602, 'T', 'TGAGA', '0/1'));
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].variationid, '296866');
  assert.deepEqual(result.matches[0].call.alleles, ['T', 'TGAGA']);
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
  const rendered = renderRecordSelection({ selected: ['v1'] }, context.recordReference);
  assert.match(rendered, /These results are from \*\*the genome file you uploaded\*\*/);
  assert.match(rendered, /selected file contains T and TGAGA/);
  assert.match(
    context.recordReference.records[0].fields.find((f) => f.label === 'ClinVar classification')
      .sources[0].url,
    /296866\/$/,
  );
});

test('public HG002 calls are labeled as example evidence throughout the request and copied answer', async () => {
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
      [],
      { genomeSource: EXAMPLE_GENOME },
    );
    assert.deepEqual(JSON.parse(context.messages[1].content).reference.genomeSource, {
      kind: 'example',
      label: EXAMPLE_GENOME.label,
    });
    assert.ok(!JSON.stringify(context.messages).includes(EXAMPLE_GENOME.sha256));
    assert.ok(!JSON.stringify(context.messages).includes(EXAMPLE_GENOME.name));
    const rendered = renderRecordSelection({ selected: ['v1', 'v2'] }, context.recordReference);
    assert.ok(
      rendered.includes(
        `These results are from the **${EXAMPLE_GENOME.label} public example genome**.`,
      ),
    );
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

test('an unanswered request is not presented as a genome result', async () => {
  const result = await matched(vcf('1', 241500602, 'T', 'TGAGA', '0/1'));
  const context = buildEmbeddingsContext(
    'An unsupported request',
    result.matches,
    result,
    LOCAL_MODELS[0],
    { mode: 'search', query: 'An unsupported request' },
    [],
    { genomeSource: EXAMPLE_GENOME },
  );
  const output = renderRecordSelection(
    { selected: [] },
    context.recordReference,
    'I could not answer that from the supplied facts.',
  );
  assert.equal(output, 'I could not answer that from the supplied facts.');
  const sourced = renderRecordSelection({ selected: ['v1'] }, context.recordReference);
  assert.match(sourced, /These results/);
});
