import test from 'node:test';
import assert from 'node:assert/strict';
import { rankCombined } from '../src/lib/evidence-ranking.js';
import { DEFAULT_WEIGHTS } from '../src/config/evidence-ranking.js';
import { MAX_RECORDS } from '../src/config/evidence-answer.js';
import { EmbeddingsSession } from '../src/lib/embeddings-session.js';
import { LocalModelSession } from '../src/lib/local-model-session.js';
import { EMBEDDINGS_ANSWER_PROMPT, EVIDENCE_OPENING_PROMPT } from '../src/prompts/embeddings.js';
import { buildEmbeddingsContext } from '../src/lib/embeddings-context.js';
import {
  buildEvidenceOpeningContext,
  parseRecordSelection,
  renderRecordSelection,
  selectionSchema,
} from '../src/lib/evidence-answer.js';
import { getModelProfile } from '../src/config/models/index.js';

const records = Array.from({ length: 30 }, (_, index) => ({
  citation: `C${index + 2}`,
  rowNumber: index + 2,
  gene: `SYNTHETIC${index}`,
  chrom: '1',
  pos: index + 100,
  ref: 'C',
  alt: 'T',
  sig: index === 29 ? 'P' : 'C',
  stars: index === 29 ? 2 : 1,
  classification: index === 29 ? 'Pathogenic' : 'Conflicting classifications',
  conditions: 'Synthetic condition',
  variationid: String(index + 1),
  pmids: '1234',
  af: '.01',
  afmax: '.02',
  grp: 'sas',
  reviewstatus: 'criteria_provided',
  call: { gt: '0/1', alleles: ['C', 'T'], copies: 1, ploidy: 2, filter: 'PASS' },
}));
const hits = records.map((_, index) => ({ index, similarity: 0.6 - index * 0.001 }));
const result = {
  build: 'GRCh38',
  matches: records,
  issues: [],
  stats: { matched: 30, needsReview: 0 },
  limitations: 'Synthetic data.',
};
const prepared = {
  identity: 'synthetic',
  total: 30,
  result,
  documents: records.map((row) => row.gene),
};

test('combined score can retrieve a record below the old top-24 cutoff without altering evidence', () => {
  const before = structuredClone({ records, hits });
  const ordered = rankCombined(hits, records);
  assert.equal(ordered.length, records.length);
  assert.equal(ordered[0].index, 29);
  assert.ok(hits.slice(0, 24).every((hit) => hit.index !== 29));
  assert.deepEqual({ records, hits }, before);
});

test('zero boosts produce pure similarity order; default boosts cannot overcome a larger semantic gap', () => {
  assert.deepEqual(
    rankCombined([...hits].reverse(), records, { classification: 0, review: 0 }).map(
      (hit) => hit.index,
    ),
    hits.map((hit) => hit.index),
  );
  const ordered = rankCombined(
    [
      { index: 0, similarity: 0.9 },
      { index: 1, similarity: 0.5 },
    ],
    [
      { sig: 'C', stars: 0 },
      { sig: 'P', stars: 4 },
    ],
  );
  assert.equal(ordered[0].index, 0);
  assert.ok(
    ordered.every(
      (hit) =>
        hit.classificationContribution + hit.reviewContribution <=
        DEFAULT_WEIGHTS.classification + DEFAULT_WEIGHTS.review,
    ),
  );
});

test('only exact fields affect boosts; unknown fields and zero stars remain distinguishable in the trace', () => {
  const changed = records.map((row) => ({
    ...row,
    gene: 'Different',
    conditions: 'Pathogenic hearing cancer',
    af: '.999',
    classification: 'Misleading prose',
  }));
  assert.deepEqual(rankCombined(hits, changed), rankCombined(hits, records));
  const ordered = rankCombined(
    [
      { index: 0, similarity: 0.5 },
      { index: 1, similarity: 0.5 },
    ],
    [
      { sig: '__proto__', stars: null, rowNumber: 10 },
      { sig: 'unknown', stars: 0, rowNumber: 5 },
    ],
  );
  assert.deepEqual(
    ordered.map((hit) => hit.index),
    [1, 0],
  );
  assert.deepEqual(
    ordered.map((hit) => hit.priority.reviewStars),
    [0, null],
  );
  assert.ok(
    ordered.every((hit) => hit.classificationContribution === 0 && hit.reviewContribution === 0),
  );
});

test('partial pools, duplicate scores, invalid values and invalid weights fail visibly', () => {
  assert.throws(() => rankCombined(hits.slice(0, 24), records), /every usable match/);
  for (const value of [NaN, Infinity, undefined])
    assert.throws(() => rankCombined([{ index: 0, similarity: value }], [records[0]]), /Invalid/);
  assert.throws(
    () =>
      rankCombined(
        [
          { index: 0, similarity: 0.5 },
          { index: 0, similarity: 0.4 },
        ],
        records.slice(0, 2),
      ),
    /Invalid/,
  );
  for (const value of [-1, 1.01, NaN, '0.1'])
    assert.throws(
      () => rankCombined(hits, records, { classification: value, review: 0.02 }),
      /weights/,
    );
  assert.deepEqual(rankCombined([], []), []);
});

test('session admits and displays three records with shared prompts, history and Other bypass', async () => {
  const requests = [],
    operations = [];
  let plan = { mode: 'search', query: 'synthetic topic' };
  const engine = {
    dispose() {},
    async reset() {},
    async *complete(request) {
      requests.push(structuredClone(request));
      const isPlanner =
        request.response_format &&
        JSON.parse(request.response_format.schema).anyOf?.some((branch) => branch.properties?.mode);
      const content = isPlanner
        ? JSON.stringify(plan)
        : request.response_format
          ? '{"selected":["v1","v2","v3"]}'
          : 'The supplied records list this condition.';
      yield { choices: [{ delta: { content }, finish_reason: 'stop' }] };
    },
  };
  const local = new LocalModelSession({
    modelId: 'qwen3.5-9b',
    checkSupport: async () => 'test',
    createEngine: async () => engine,
  });
  await local.initialize();
  const session = new EmbeddingsSession({
    local,
    search: {
      dispose() {},
      async call(operation) {
        operations.push(operation);
        return hits;
      },
    },
    fetchImpl: () => {
      throw new Error('Unexpected network request');
    },
  });
  session.prepareIndex = async () => prepared;
  await session.send('First question');
  assert.equal(session.state.error, null);
  const first = session.state.messages.at(-1);
  assert.equal(first.context.included, 3);
  assert.equal(first.context.maxNewRecords, MAX_RECORDS);
  assert.equal(first.context.recordReference.maxSelectedRecords, MAX_RECORDS);
  assert.equal(JSON.parse(requests[1].response_format.schema).properties.selected.maxItems, 3);
  assert.equal(first.answerSelection.selected.length, 3);
  assert.equal(first.content.split('**Overall frequency:**').length - 1, 3);
  assert.equal(JSON.parse(requests[2].messages.at(-1).content).reference.records.length, 3);
  assert.equal(first.context.evidence.coverage.currentTurn.retrievedCandidates, 30);
  assert.equal(first.context.evidence.matches[0].gene, 'SYNTHETIC29');
  assert.equal(
    first.journey.steps.some((step) => step.id === 'ranking'),
    false,
  );
  assert.equal(first.journey.steps.find((step) => step.id === 'semantic').data.scores.length, 30);
  assert.equal(requests[1].messages[0].content, EMBEDDINGS_ANSWER_PROMPT);
  assert.equal(requests[2].messages[0].content, EVIDENCE_OPENING_PROMPT);
  session.setWeights({ classification: 0, review: 0 });
  plan = { mode: 'search', query: 'another topic resolved by planner' };
  await session.send('Follow-up or topic change');
  const follow = session.state.messages.at(-1);
  assert.equal(session.state.error, null);
  assert.equal(follow.context.historyTurns, 1);
  assert.equal(follow.context.evidence.matches[0].gene, 'SYNTHETIC0');
  assert.equal(follow.context.evidence.earlierMatches[0].gene, 'SYNTHETIC29');
  assert.deepEqual(
    first.journey.steps.find((step) => step.id === 'semantic').data.weights,
    DEFAULT_WEIGHTS,
  );
  plan = { mode: 'overview', query: '' };
  await session.send('Whole pool');
  assert.equal(session.state.messages.at(-1).context.evidence.matches[0].gene, 'SYNTHETIC29');
  plan = { mode: 'other', query: '' };
  await session.send('General question');
  assert.equal(session.state.messages.at(-1).general, true);
  assert.deepEqual(operations, ['score', 'score']);
  assert.equal(session.state.error, null);
  session.dispose();
});

test('three-record default covers new and earlier selections', () => {
  const profile = getModelProfile('qwen3.5-9b'),
    plan = { mode: 'search', query: 'synthetic topic' };
  const first = buildEmbeddingsContext('First', records, result, profile, plan);
  const history = [
    { question: 'First', answer: 'Earlier source records', records: first.evidence.matches },
  ];
  const context = buildEmbeddingsContext(
    'Compare',
    records.slice(3),
    result,
    profile,
    plan,
    history,
    { maxNewRecords: MAX_RECORDS, maxSelectedRecords: MAX_RECORDS },
  );
  assert.equal(first.included, 3);
  assert.equal(selectionSchema(first.recordReference).properties.selected.maxItems, 3);
  assert.equal(context.recordReference.records.length, 6);
  assert.equal(selectionSchema(context.recordReference).properties.selected.maxItems, 3);
  const selected = { selected: ['v1', 'v3', 'v5'] };
  assert.deepEqual(
    parseRecordSelection(JSON.stringify(selected), context.recordReference),
    selected,
  );
  assert.equal(
    renderRecordSelection(selected, context.recordReference).split('**ClinVar classification:**')
      .length - 1,
    3,
  );
  const opening = buildEvidenceOpeningContext(
    'Compare',
    selected,
    context.recordReference,
    profile,
  );
  assert.equal(JSON.parse(opening.messages.at(-1).content).reference.records.length, 3);
  assert.throws(() =>
    parseRecordSelection('{"selected":["v1","v2","v3","v4"]}', context.recordReference),
  );
  for (const maxSelectedRecords of [0, 5, 2.5, '3'])
    assert.throws(
      () =>
        buildEmbeddingsContext('Compare', records, result, profile, plan, [], {
          maxSelectedRecords,
        }),
      /Selected-record limit/,
    );
});

test('a third record exceeding the context budget is omitted whole without taking a lower-ranked substitute', () => {
  const candidates = [
    records[0],
    records[1],
    { ...records[2], conditions: 'Condition '.repeat(5000) },
    records[3],
  ];
  const context = buildEmbeddingsContext(
    'Review',
    candidates,
    result,
    getModelProfile('qwen3-4b'),
    { mode: 'search', query: 'synthetic topic' },
    [],
    { maxNewRecords: MAX_RECORDS, maxSelectedRecords: MAX_RECORDS },
  );
  assert.equal(context.maxNewRecords, 3);
  assert.equal(context.included, 2);
  assert.equal(context.consideredRows[2].status, 'context_budget');
  assert.equal(context.consideredRows.length, 3);
  assert.equal(selectionSchema(context.recordReference).properties.selected.maxItems, 2);
  assert.deepEqual(
    context.evidence.matches.map((record) => record.gene),
    ['SYNTHETIC0', 'SYNTHETIC1'],
  );
  assert.ok(context.inputBytes <= context.inputByteLimit);
});
