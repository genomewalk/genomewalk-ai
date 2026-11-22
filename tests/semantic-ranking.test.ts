import type { ModelRequest, SearchPlan } from '../src/lib/types.ts';
import { fakeEngine, fakeSearch } from './helpers/inference.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { rankSemantic } from '../src/lib/evidence-ranking.ts';
import { MAX_CANDIDATES, MAX_RECORDS } from '../src/config/evidence-answer.ts';
import { EmbeddingsSession } from '../src/lib/embeddings-session.ts';
import { LocalModelSession } from '../src/lib/local-model-session.ts';
import { EMBEDDINGS_ANSWER_PROMPT, EVIDENCE_OPENING_PROMPT } from '../src/prompts/embeddings.ts';
import { buildEmbeddingsContext } from '../src/lib/embeddings-context.ts';
import {
  buildEvidenceOpeningContext,
  parseRecordSelection,
  renderRecordSelection,
  selectionSchema,
} from '../src/lib/evidence-answer.ts';
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
  assert.ok(ordered.every((hit) => hit.score === hit.similarity));
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

test('session admits ten candidates and displays three selections with shared prompts and Other bypass', async () => {
  const requests: ModelRequest[] = [];
  const operations: string[] = [];
  let plan: SearchPlan = { mode: 'search', query: 'synthetic topic' };
  const engine = fakeEngine({
    dispose() {},
    async reset() {},
    async *complete(request) {
      requests.push(structuredClone(request));
      const isPlanner =
        request.response_format &&
        JSON.parse(request.response_format.schema!).anyOf?.some(
          (branch: { properties?: { mode?: unknown } }) => branch.properties?.mode,
        );
      const content = isPlanner
        ? JSON.stringify(plan)
        : request.response_format
          ? '{"selected":["v1","v2","v3"]}'
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
  assert.equal(first!.context!.included, MAX_CANDIDATES);
  assert.equal(first!.context!.maxNewRecords, MAX_CANDIDATES);
  assert.equal(first!.context!.recordReference!.maxSelectedRecords, MAX_RECORDS);
  assert.equal(JSON.parse(requests[1]!.response_format!.schema!).properties.selected.maxItems, 3);
  assert.equal(first!.answerSelection!.selected.length, 3);
  assert.equal(first!.content.split('**Overall frequency:**').length - 1, 3);
  assert.equal(JSON.parse(requests[2]!.messages.at(-1)!.content).reference.records.length, 3);
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
  assert.equal(requests[1]!.messages[0]!.content, EMBEDDINGS_ANSWER_PROMPT);
  assert.equal(requests[2]!.messages[0]!.content, EVIDENCE_OPENING_PROMPT);
  plan = { mode: 'search', query: 'another topic resolved by planner' };
  await session.send('Follow-up or topic change');
  const follow = session.state.messages.at(-1)!;
  assert.equal(session.state.error, null);
  assert.equal(follow!.context!.historyTurns, 1);
  assert.equal(follow!.context!.evidence!.matches[0]!.gene, 'SYNTHETIC0');
  assert.equal(
    follow!.context!.evidence!.earlierMatches.length,
    0,
    'Repeated records are deduplicated',
  );
  plan = { mode: 'overview', query: '' };
  await session.send('Whole pool');
  assert.equal(session.state.messages.at(-1)!.context!.evidence!.matches[0]!.gene, 'SYNTHETIC29');
  plan = { mode: 'other', query: '' };
  await session.send('General question');
  assert.equal(session.state.messages.at(-1)!.general, true);
  assert.deepEqual(operations, ['score', 'score']);
  assert.equal(session.state.error, null);
  session.dispose();
});

test('three-record default covers new and earlier selections', () => {
  const profile = getModelProfile('qwen3.5-9b'),
    plan: SearchPlan = { mode: 'search', query: 'synthetic topic' };
  const first = buildEmbeddingsContext('First', records, result, profile, plan, [], {
    maxNewRecords: MAX_RECORDS,
  });
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
  assert.equal(JSON.parse(opening.messages.at(-1)!.content).reference.records.length, 3);
  assert.throws(() =>
    parseRecordSelection('{"selected":["v1","v2","v3","v4"]}', context.recordReference),
  );
  for (const maxSelectedRecords of [0, 5, 2.5, '3'])
    assert.throws(
      () =>
        buildEmbeddingsContext('Compare', records, result, profile, plan, [], {
          // @ts-expect-error Deliberately test invalid limits from an untyped caller.
          maxSelectedRecords,
        }),
      /Selected-record limit/,
    );
});

test('recent verified records survive when new candidates would crowd out the last turn', () => {
  const plan: SearchPlan = { mode: 'search', query: 'synthetic topic' };
  const fullProfile = getModelProfile('qwen3.5-9b');
  const initial = buildEmbeddingsContext('First', records, result, fullProfile, plan, [], {
    maxNewRecords: MAX_RECORDS,
  });
  const history = [
    { question: 'First', answer: 'Earlier findings', records: initial.evidence.matches },
  ];
  const reserved = buildEmbeddingsContext('Follow up', [], result, fullProfile, plan, history);
  // A valid budget that fits the complete recent turn, but not three more records.
  const profile = { ...fullProfile, contextWindowTokens: reserved.inputBytes + 4096 + 768 + 500 };
  const fresh = buildEmbeddingsContext('Follow up', records.slice(3), result, profile, plan);
  const follow = buildEmbeddingsContext(
    'Follow up',
    records.slice(3),
    result,
    profile,
    plan,
    history,
  );
  assert.equal(follow.historyTurns, 1);
  assert.deepEqual(follow.evidence.earlierMatches, history[0]!.records);
  assert.ok(fresh.included > follow.included);
  assert.ok(follow.consideredRows.some((row) => row.status === 'context_budget'));
  assert.ok(follow.inputBytes <= follow.inputByteLimit);
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
    { mode: 'search', query: 'synthetic topic' },
    [],
    { maxNewRecords: MAX_RECORDS, maxSelectedRecords: MAX_RECORDS },
  );
  assert.equal(context.maxNewRecords, 3);
  assert.equal(context.included, 2);
  assert.equal(context.consideredRows[2]!.status, 'context_budget');
  assert.equal(context.consideredRows.length, 3);
  assert.equal(selectionSchema(context.recordReference).properties.selected.maxItems, 2);
  assert.deepEqual(
    context.evidence.matches.map((record) => record.gene),
    ['SYNTHETIC0', 'SYNTHETIC1'],
  );
  assert.ok(context.inputBytes <= context.inputByteLimit);
});
