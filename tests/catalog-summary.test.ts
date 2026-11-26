import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogSummary } from '../src/lib/catalog-summary.ts';
import type { MatchedRow } from '../src/lib/types.ts';

function row(
  gene: string,
  sig: string,
  stars: number | null,
  classification: string,
  fields: Partial<MatchedRow> = {},
): MatchedRow {
  return {
    gene,
    sig,
    stars,
    classification,
    chrom: '1',
    pos: 100,
    ref: 'A',
    alt: 'T',
    citation: gene,
    call: { gt: '0/1', alleles: ['A', 'T'], copies: 1 },
    ...fields,
  };
}

test('the three leading variants use Genomewalk review group, stars, disease classification and stable ties', () => {
  const records = [
    row('conflict', 'C', 4, 'conflicting'),
    row('p0', 'P', 0, 'pathogenic'),
    row('plp2', 'PLP', 2, 'pathogenic/likely pathogenic'),
    row('p2', 'P', 2, 'pathogenic'),
    row('lp4', 'LP', 4, 'likely pathogenic'),
    row('tied', 'P', 2, 'pathogenic'),
  ];
  const original = structuredClone(records);
  const summary = buildCatalogSummary(records);
  assert.deepEqual(
    summary
      .split('Review first (4 variants, 3 shown)\n')[1]!
      .split('\n\n')[0]!
      .split('\n')
      .map((line) => line.split(' | ')[0]),
    ['lp4', 'p2', 'tied'],
  );
  assert.match(summary, /Review first 4, Less-reviewed disease claims 1, Other ClinVar matches 1/);
  assert.deepEqual(records, original);
});

test('summary counts the whole pool and adds one example per remaining category, sharing multi-category records', () => {
  const records = [
    row('A', 'P', 2, 'Pathogenic', {
      af: 0,
      pmids: '1,2',
      rsids: '15',
      conditions: 'See_cases|one|two|not_specified|one',
    }),
    row('A', 'P', 0, 'Pathogenic', { af: 1.5, conditions: 'two|not_provided' }),
    row('.', 'LP', 0, 'Likely_pathogenic|protective', { variationid: '234' }),
    row('C', 'O', 3, 'drug_response|affects', { rsids: 'rs16', af: '.25' }),
    row('D', 'O', null, 'other', { conditions: 'three' }),
  ];
  const summary = buildCatalogSummary(records);
  for (const expected of [
    'Total variants: 5',
    'Distinct named genes: 3. Variants without a supplied gene: 1.',
    'Disease evidence 3, Drug response 1, Associations 1, Traits 1, Other 1',
    'With overall gnomAD frequency: 2. With linked publications: 1.',
    '3: 1, 2: 1, 1: 0, 0: 2, unknown: 1',
    'A rs15 | Pathogenic | 2 | one (+1 more)',
    'Likely pathogenic; protective | 0',
    'Record ID: ClinVar 234',
    'Distinct condition or trait names listed across matches: 3.',
    'Drug response example\nC rs16',
    'Other example\nD',
  ])
    assert.ok(summary.includes(expected), expected);
  assert.equal(summary.match(/rs16/g)?.length, 1);
  assert.doesNotMatch(summary, /Traits example|Associations example|null|undefined/);
});

test('empty pools have explicit zero coverage; long fields are deferred to detailed records', () => {
  assert.match(buildCatalogSummary([]), /Total variants: 0/);
  assert.match(
    buildCatalogSummary([]),
    /Distinct condition or trait names listed across matches: 0/,
  );
  assert.doesNotMatch(buildCatalogSummary([]), /Variants prioritized for review/);
  const summary = buildCatalogSummary([
    row('', 'C', null, 'Conflicting', { conditions: 'L'.repeat(2000) }),
  ]);
  assert.match(summary, /1:100 A>T/);
  assert.match(summary, /see full record/);
  assert.doesNotMatch(summary, /Starting query/);
  assert.doesNotMatch(summary, /LLLLLL/);
});
