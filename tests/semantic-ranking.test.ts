import { buildCatalogSummary } from '../src/lib/catalog-summary.ts';
import type { ModelRequest, SearchPlan } from '../src/lib/types.ts';
import { fakeEngine, fakeSearch } from './helpers/inference.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { rankSemantic } from '../src/lib/evidence-ranking.ts';
import { RECORD_LIMIT } from '../src/config/evidence-answer.ts';
import { EmbeddingsSession } from '../src/lib/embeddings-session.ts';
import { LocalModelSession } from '../src/lib/local-model-session.ts';
import { ANSWER_PROMPT } from '../src/prompts/answer.ts';
import { buildEmbeddingsContext } from '../src/lib/embeddings-context.ts';
import { getModelProfile } from '../src/config/models/index.ts';

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
  stats: { records: 30, matched: 30, needsReview: 0 },
  limitations: 'Synthetic data.',
};
const prepared = {
  identity: 'synthetic',
  summary: buildCatalogSummary(records),
  source: { build: 'GRCh38', sha256: 'synthetic' },
  total: 30,
  result,
  documents: records.map((row) => row.gene),
};

test('semantic ranking scores the full pool without boosting classification or review', () => {
  const before = structuredClone({ records, hits });
  const ordered = rankSemantic([...hits].reverse(), records);
  assert.equal(ordered.length, records.length);
  assert.deepEqual(
    ordered.map((hit) => hit.index),
    hits.map((hit) => hit.index),
  );
  assert.equal(
    ordered.at(-1)!.index,
    29,
    'Pathogenic classification cannot displace a better topic match',
  );
  const changed = records.map((row) => ({ ...row, sig: 'P', stars: 4 }));
  assert.deepEqual(
    rankSemantic(hits, changed).map((hit) => hit.index),
    ordered.map((hit) => hit.index),
  );
  assert.deepEqual({ records, hits }, before);
});

test('exact similarity ties use catalog order, while missing review information remains visible', () => {
  const ordered = rankSemantic(
    [
      { index: 0, similarity: 0.5 },
      { index: 1, similarity: 0.5 },
    ],
    [
      { sig: 'P', stars: 4, rowNumber: 10 },
      { sig: 'unknown', stars: null, rowNumber: 5 },
    ],
  );
  assert.deepEqual(
    ordered.map((hit) => hit.index),
    [1, 0],
  );
  assert.deepEqual(
    ordered.map((hit) => hit.priority.reviewStars),
    [null, 4],
  );
});

test('partial pools, duplicate indices and invalid similarities fail visibly', () => {
  assert.throws(() => rankSemantic(hits.slice(0, 24), records), /every usable match/);
  for (const value of [NaN, Infinity, undefined])
    // @ts-expect-error Runtime validation rejects missing scores.
    assert.throws(() => rankSemantic([{ index: 0, similarity: value }], [records[0]!]), /Invalid/);
  for (const index of [-1, 0, 3, 0.5])
    assert.throws(
      () =>
        rankSemantic(
          [
            { index: 0, similarity: 0.5 },
            { index, similarity: 0.4 },
          ],
          records.slice(0, 2),
        ),
      /Invalid/,
    );
  assert.deepEqual(rankSemantic([], []), []);
});

test('each question searches the full pool, answers once and preserves history', async () => {
  const requests: ModelRequest[] = [];
  const operations: string[] = [];
  let plan: SearchPlan = { query: 'synthetic topic' };
  const engine = fakeEngine({
    dispose() {},
    async reset() {},
    async *complete(request) {
      requests.push(structuredClone(request));
      const content = request.response_format
        ? JSON.stringify(plan)
        : 'The supplied records list this condition.';
      yield { choices: [{ delta: { content }, finish_reason: 'stop' }] };
    },
  });
  const local = new LocalModelSession({
    modelId: 'qwen3.5-9b',
    checkSupport: async () => 'test',
    createEngine: async () => engine,
  });
  await local.initialize();
  const session = new EmbeddingsSession({
    local,
    search: fakeSearch(async (operation) => {
      operations.push(operation);
      return hits;
    }),
    fetchImpl: () => {
      throw new Error('Unexpected network request');
    },
  });
  session.prepareIndex = async () => prepared;
  await session.send('First question');
  assert.equal(session.state.error, null);
  const first = session.state.messages.at(-1)!;
  assert.equal(first!.context!.included, RECORD_LIMIT.topic);
  assert.equal(first!.context!.maxNewRecords, RECORD_LIMIT.topic);
  assert.equal(requests.length, 2);
  assert.equal(requests[1]!.response_format, undefined);
  assert.equal(first!.content, 'The supplied records list this condition.');
  assert.equal(JSON.parse(requests[1]!.messages.at(-1)!.content.split('\n')[1]!).length, 5);
  assert.equal(first!.context!.evidence!.coverage.currentTurn.retrievedCandidates, 30);
  assert.equal(first!.context!.evidence!.matches[0]!.gene, 'SYNTHETIC0');
  assert.equal(
    first!.journey!.steps.some((step) => String(step.id) === 'ranking'),
    false,
  );
  assert.equal(
    first!.journey!.steps.find((step) => step.id === 'semantic')!.data!.scores!.length,
    30,
  );
  assert.equal(requests[1]!.messages[0]!.content, ANSWER_PROMPT);
  plan = { query: 'another topic resolved by planner' };
  await session.send('Follow-up or topic change');
  const follow = session.state.messages.at(-1)!;
  assert.equal(session.state.error, null);
  assert.equal(follow!.context!.historyTurns, 1);
  assert.equal(follow!.context!.evidence!.matches[0]!.gene, 'SYNTHETIC0');
  assert.equal(
    follow!.context!.recordReference.records.length,
    follow!.context!.included,
    'Previous source payloads are not appended to history',
  );
  plan = { query: 'SYNTHETIC29' };
  await session.send('Whole pool');
  assert.equal(session.state.messages.at(-1)!.context!.evidence!.matches[0]!.gene, 'SYNTHETIC0');
  plan = { query: 'general question' };
  await session.send('General question');
  assert.equal(session.state.messages.at(-1)!.context!.historyTurns, 3);
  assert.deepEqual(operations, ['score', 'score', 'score', 'score']);
  assert.equal(session.state.error, null);
  session.dispose();
});

test('a small context omits whole candidates and stays within the topic limit', () => {
  const plan: SearchPlan = { query: 'synthetic topic' };
  const profile = { ...getModelProfile('qwen3.5-9b'), contextWindowTokens: 9000 };
  const c = buildEmbeddingsContext('Question', records, result, profile, plan);
  assert.ok(c.included < RECORD_LIMIT.topic);
  assert.ok(c.consideredRows.some((row) => row.status === 'context_budget'));
  assert.ok(c.inputBytes <= c.inputByteLimit);
  assert.equal(c.historyTurns, 0);
});

test('a third record exceeding the context budget is omitted whole without taking a lower-ranked substitute', () => {
  const candidates = [
    records[0]!,
    records[1]!,
    { ...records[2]!, conditions: 'Condition '.repeat(5000) },
    records[3]!,
  ];
  const context = buildEmbeddingsContext(
    'Review',
    candidates,
    result,
    getModelProfile('qwen3-4b'),
    { query: 'synthetic topic' },
    { maxNewRecords: 3 },
  );
  assert.equal(context.maxNewRecords, 3);
  assert.equal(context.included, 2);
  assert.equal(context.consideredRows[2]!.status, 'context_budget');
  assert.equal(context.consideredRows.length, 3);
  assert.deepEqual(
    context.evidence.matches.map((record) => record.gene),
    ['SYNTHETIC0', 'SYNTHETIC1'],
  );
  assert.ok(context.inputBytes <= context.inputByteLimit);
});
