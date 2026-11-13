import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogPriority, rankCatalogOverview, rankCombined } from '../src/lib/evidence-ranking.ts';

test('overview uses classification, stars and catalog row order across the entire pool', () => {
  const records = [
    { sig: 'C', stars: 4 },
    { sig: 'O', stars: 4 },
    { sig: 'unknown', stars: 4 },
    { sig: 'P', stars: 0 },
    { sig: 'LP', stars: 4 },
    { sig: 'P', stars: 2, rowNumber: 9 },
    { sig: 'PLP', stars: 2, rowNumber: 8 },
    { sig: 'PLP', stars: 3 },
  ];
  const before = structuredClone(records);
  const ranked = rankCatalogOverview(records);
  assert.deepEqual(
    ranked.map((r) => r.index),
    [7, 6, 5, 3, 4, 0, 1, 2],
  );
  assert.ok(ranked.every((r) => !('similarity' in r) && !('score' in r)));
  assert.deepEqual(records, before);
  assert.deepEqual(rankCatalogOverview([]), []);
});

test('catalog features preserve the configured class values without parsing prose', () => {
  const values = ['P', 'PLP', 'LP', 'C', 'O'].map((sig) => catalogPriority({ sig }).classValue);
  assert.deepEqual(values, [1, 1, 0.75, 0.5, 0.25]);
  for (const sig of [undefined, '', 'p', ' P ', 'Pathogenic', 'toString']) {
    const priority = catalogPriority({ sig, classification: 'Pathogenic', stars: 4 });
    assert.equal(priority.classificationOrder, 4);
    assert.equal(priority.classValue, 0);
  }
  const records = [undefined, null, '', '4', -1, 5, 1.5, NaN, 0].map((stars) => ({
    sig: 'P',
    stars,
  }));
  const ranked = rankCatalogOverview(records);
  assert.equal(
    ranked[0]!.index,
    8,
    'Known zero stars outrank missing review information in an overview',
  );
  assert.ok(ranked.slice(1).every((r) => r.priority.reviewStars === null));
});

test('gene, condition, frequency and genotype cannot change field-based overview order or boosts', () => {
  const records = [
    { sig: 'C', stars: 1 },
    { sig: 'P', stars: 2 },
    { sig: 'C', stars: 2 },
  ];
  const changed = records.map((r, i) => ({
    ...r,
    gene: `GENE${i}`,
    conditions: 'Pathogenic severe hearing cancer',
    classification: 'Benign',
    reviewstatus: 'reviewed_by_expert_panel',
    af: 0.99,
    afmax: 1,
    call: { copies: 2, gt: '1/1' },
  }));
  assert.deepEqual(rankCatalogOverview(changed), rankCatalogOverview(records));
  const scores = records.map((_, index) => ({ index, similarity: 0.5 }));
  assert.deepEqual(rankCombined(scores, changed), rankCombined(scores, records));
});
