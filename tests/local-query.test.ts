import type { ModelRequest, ModelChunk, MatchedRow } from '../src/lib/types.ts';
import { fakeEngine, fakeSearch } from './helpers/inference.ts';
import test from 'node:test';
import { EVIDENCE_OPENING_PROMPT } from '../src/prompts/embeddings.ts';
import assert from 'node:assert/strict';
import { LocalModelSession } from '../src/lib/local-model-session.ts';
import { EmbeddingsSession } from '../src/lib/embeddings-session.ts';
import { parseLocalQuery, buildLocalQueryContext } from '../src/lib/local-query.ts';
import { QUERY_SCHEMA } from '../src/config/search-scope.ts';
import { buildGeneralContext } from '../src/lib/general-context.ts';
import { conversationMessages, fitConversation } from '../src/lib/conversation-context.ts';
import { LOCAL_MODELS } from '../src/config/models/index.ts';

const plan = (mode: string, query = '') => ({ mode, query });
const selected = (ids: string[]) => ({
  raw: JSON.stringify({ selected: ids }),
  finish: 'stop' as const,
});

const rows = Array.from({ length: 30 }, (_, i) => ({
  citation: `C${i + 1}`,
  rowNumber: i + 2,
  gene: `FIXTURE${i + 1}`,
  chrom: '1',
  pos: 100 + i,
  ref: 'C',
  alt: 'T',
  sig: i === 29 ? 'P' : 'C',
  stars: i === 29 ? 2 : 1,
  classification: i === 29 ? 'Pathogenic' : 'Conflicting_classifications',
  conditions: 'Synthetic_test_condition',
  call: { gt: '0/1', alleles: ['C', 'T'], copies: 1 },
}));

async function harness(
  plans: { mode: string; query: string }[],
  answers: { raw: string; finish: ModelChunk['choices'][number]['finish_reason'] }[] = [],
  records: MatchedRow[] = rows,
  openingReply: { raw: string; finish: ModelChunk['choices'][number]['finish_reason'] } = {
    raw: 'These records contain the requested annotations.',
    finish: 'stop' as const,
  },
) {
  const requests: ModelRequest[] = [];
  const openingRequests: ModelRequest[] = [];
  const operations: string[] = [];
  const local = new LocalModelSession({
    modelId: 'qwen3-4b',
    checkSupport: async () => 'test',
    createEngine: async () =>
      fakeEngine({
        async reset() {},
        dispose() {},
        async *complete(request) {
          if (request.messages[0]!.content === EVIDENCE_OPENING_PROMPT) {
            openingRequests.push(structuredClone(request));
            yield {
              choices: [
                { delta: { content: openingReply.raw }, finish_reason: openingReply.finish },
              ],
            };
            return;
          }
          requests.push(structuredClone(request));
          const planning = Boolean(
            request.response_format &&
            JSON.parse(request.response_format.schema!).anyOf?.some(
              (branch: { properties?: { mode?: unknown } }) => branch.properties?.mode,
            ),
          );
          const reply = planning
            ? { raw: JSON.stringify(plans.shift()), finish: 'stop' as const }
            : (answers.shift() ?? {
                raw: JSON.stringify({ selected: ['v1'] }),
                finish: 'stop' as const,
              });
          yield { choices: [{ delta: { content: reply.raw }, finish_reason: reply.finish }] };
        },
      }),
  });
  await local.initialize();
  const session = new EmbeddingsSession({
    local,
    search: fakeSearch(async (op) => {
      operations.push(op);
      return records.map((_, index) => ({ index, similarity: 1 - index / 100 }));
    }),
  });
  session.update({ phase: 'ready' });
  let preparations = 0;
  session.prepareIndex = async () => {
    preparations++;
    return (session.prepared = {
      identity: 'fixture',
      source: { build: 'GRCh38', sha256: 'synthetic' },
      total: records.length,
      result: {
        build: 'GRCh38',
        matches: records,
        issues: [],
        stats: { records: records.length, matched: records.length, needsReview: 0 },
        limitations: 'Synthetic fixture',
      },
      documents: records.map((r) => r.gene ?? ''),
    });
  };
  return { session, requests, openingRequests, operations, preparations: () => preparations };
}

test('exactly three categories; removed routes and extra routing fields are rejected', () => {
  assert.deepEqual(
    QUERY_SCHEMA.anyOf.map((b) => b.properties.mode.enum[0]!),
    ['search', 'overview', 'other'],
  );
  for (const value of [plan('search', 'hearing'), plan('overview'), plan('other')]) {
    assert.deepEqual(parseLocalQuery(JSON.stringify(value)), value);
  }
  for (const value of [
    plan('search'),
    plan('overview', 'topic'),
    plan('other', 'topic'),
    ...['reuse', 'educate', 'clarify', 'unresolved', 'invalid'].map((mode) => plan(mode)),
    { ...plan('search', 'hearing'), usePreviousEvidence: true },
    { ...plan('other'), clarification: 'Which?' },
    [],
  ]) {
    assert.throws(() => parseLocalQuery(JSON.stringify(value)), /invalid search plan/);
  }
  assert.throws(() => parseLocalQuery('```json\n{}\n```'));
});

test('Other responds without genome preparation and stores the complete conversation', async () => {
  const h = await harness(
    [plan('other'), plan('other')],
    [
      { raw: 'A chromosome contains DNA.', finish: 'stop' as const },
      { raw: 'DNA is packaged into chromosomes.', finish: 'stop' as const },
    ],
  );
  h.session.fetch = () => {
    throw new Error('Must not request genome data');
  };
  await h.session.send('What is a chromosome?');
  await h.session.send('Explain that more simply.');
  assert.equal(h.session.state.error, null);
  assert.equal(h.preparations(), 0);
  assert.deepEqual(h.operations, []);
  assert.equal(h.session.state.messages.at(-1)!.general, true);
  assert.deepEqual(h.session.history[0]!, {
    question: 'What is a chromosome?',
    answer: 'A chromosome contains DNA.',
    records: [],
  });
  for (const request of [h.requests[2]!, h.requests[3]!]) {
    assert.deepEqual(request.messages.slice(1), [
      { role: 'user', content: 'What is a chromosome?' },
      { role: 'assistant', content: 'A chromosome contains DNA.' },
      { role: 'user', content: 'Explain that more simply.' },
    ]);
  }
  assert.equal(h.requests[1]!.response_format, undefined);
  for (const profile of LOCAL_MODELS) {
    const c = buildGeneralContext('What is a chromosome?', [], profile);
    assert.deepEqual(c.messages, h.requests[1]!.messages);
    assert.equal(c.responseTokenLimit, profile.contextWindowTokens);
    assert.ok(c.inputBytes <= c.inputByteLimit);
  }
});

test('clarification is an ordinary Other answer and its reply uses Q&A history with no pending state', async () => {
  const h = await harness(
    [plan('other'), plan('search', 'hearing variants')],
    [{ raw: 'Which topic or finding do you mean?', finish: 'stop' as const }, selected(['v1'])],
  );
  await h.session.send('Which of those?');
  await h.session.send('The hearing-related variants.');
  assert.equal(h.session.state.error, null);
  assert.equal(h.requests.length, 4);
  assert.deepEqual(h.operations, ['score']);
  assert.equal(h.preparations(), 1);
  assert.equal(Object.hasOwn(h.session, 'pendingClarification'), false);
  assert.deepEqual(h.requests[2]!.messages.slice(1), [
    { role: 'user', content: 'Which of those?' },
    { role: 'assistant', content: 'Which topic or finding do you mean?' },
    { role: 'user', content: 'The hearing-related variants.' },
  ]);
  h.session.clear();
  assert.deepEqual(h.session.history, []);
});

test('follow-ups and topic changes use conversation; only selected verified records enter the reference', async () => {
  const h = await harness(
    [plan('search', 'hearing'), plan('other'), plan('search', 'cancer')],
    [
      selected(['v1']),
      { raw: 'UNVERIFIED_INTERPRETATION_SENTINEL', finish: 'stop' as const },
      selected(['v2']),
    ],
  );
  await h.session.send('Review hearing variants');
  await h.session.send('What does that term mean?');
  await h.session.send('What about cancer?');
  assert.equal(h.session.state.error, null);
  assert.deepEqual(h.operations, ['score', 'score']);
  assert.equal(
    h.session.history[0]!.records!.length,
    1,
    'Only the displayed record is retained as evidence',
  );
  assert.deepEqual(h.session.history[1]!.records, []);
  const request = h.requests[5]!;
  assert.ok(
    request.messages.some(
      (m) => m.role === 'assistant' && m.content === 'UNVERIFIED_INTERPRETATION_SENTINEL',
    ),
  );
  const reference = JSON.parse(request.messages.at(-1)!.content).reference;
  assert.ok(!JSON.stringify(reference).includes('UNVERIFIED_INTERPRETATION_SENTINEL'));
  assert.deepEqual(
    reference.records.map((r: { gene: string }) => r.gene),
    ['FIXTURE1', 'FIXTURE2', 'FIXTURE3'],
    'Repeated source records are deduplicated',
  );
  assert.equal(h.session.state.messages.at(-1)!.context!.historyTurns, 2);
  assert.equal(h.session.history[2]!.records![0]!.gene, 'FIXTURE2');
});

test('newest complete turns fit the budget; older turns are dropped whole with no summary or question rules', () => {
  const profile = { ...LOCAL_MODELS[0]!, contextWindowTokens: 6500 };
  const previous = [0, 1, 2].map((i) => ({
    question: 'question ' + i,
    answer: String(i).repeat(1100),
    records: [],
  }));
  const c = buildLocalQueryContext('Latest question', previous, {
    ...LOCAL_MODELS[0]!,
    contextWindowTokens: 9000,
  });
  assert.equal(c.historyTurns, 1);
  assert.equal(c.omittedHistoryTurns, 2);
  assert.deepEqual(c.messages.slice(1, -1), [
    { role: 'user', content: 'question 2' },
    { role: 'assistant', content: '2'.repeat(1100) },
  ]);
  assert.ok(c.inputBytes <= c.inputByteLimit);
  assert.equal(c.responseTokenLimit, 9000);
  const big = fitConversation(previous, profile, (history) => ({
    messages: conversationMessages('Rules', 'Latest', history),
    generation: { response_format: { type: 'json_object' as const, schema: 'S'.repeat(1500) } },
  }));
  assert.equal(big.historyTurns, 0, 'Schema size counts against the same budget');
  assert.throws(() => buildLocalQueryContext('x'.repeat(10000), [], profile), /context budget/);
});

test('every question follows the model-selected category without inspecting question words', async () => {
  for (const question of [
    'Which variants should I be most concerned about?',
    'Review hearing variants',
    'arbitrary wording',
  ]) {
    const h = await harness([plan('overview')]);
    await h.session.send(question);
    assert.equal(h.session.state.error, null);
    assert.deepEqual(h.operations, []);
    assert.equal(h.session.state.messages.at(-1)!.context!.evidence!.matches[0]!.gene, 'FIXTURE30');
    assert.equal(
      h.session.state.messages.at(-1)!.context!.evidence!.coverage.currentTurn.retrievedCandidates,
      30,
    );
    assert.equal(h.requests.length, 2);
    assert.equal(
      h.session.state.messages.at(-1)!.journey!.steps.find((s) => s.id === 'query')!.data!
        .decisionSource,
      'local_model',
    );
  }
});

test('all model profiles use the same three-category prompt, grammar and native context cap', () => {
  const previous = [{ question: 'Question', answer: 'Answer', records: [] }];
  const first = buildLocalQueryContext('Follow up', previous, LOCAL_MODELS[0]!);
  for (const profile of LOCAL_MODELS) {
    const c = buildLocalQueryContext('Follow up', previous, profile);
    assert.deepEqual(c.messages, first.messages);
    assert.deepEqual(c.generation, first.generation);
    assert.equal(c.responseTokenLimit, profile.contextWindowTokens);
  }
});

test('invalid plans fail visibly before matching or retrieval', async () => {
  const h = await harness([plan('invalid')]);
  await h.session.send('Broad-looking wording');
  assert.match(h.session.state.error!.message, /invalid search plan/);
  assert.equal(h.preparations(), 0);
  assert.equal(h.session.history.length, 0);
});

test('unfinished general answers and invalid record selections never enter follow-up history', async () => {
  const h = await harness([plan('other')], [{ raw: 'Incomplete text', finish: 'length' as const }]);
  await h.session.send('Explain a concept');
  assert.equal(h.session.state.messages.at(-1)!.limited, true);
  assert.equal(h.session.history.length, 0);
  for (const reply of [
    { raw: JSON.stringify({ selected: ['v1'], diagnosis: 'INVENTED' }), finish: 'stop' as const },
    { raw: JSON.stringify({ selected: ['v1'] }), finish: 'length' as const },
    { raw: 'Invented interpretation', finish: 'stop' as const },
  ]) {
    const r = await harness([plan('overview')], [reply]);
    await r.session.send('Review my findings');
    assert.equal(r.session.state.messages.at(-1)!.status, 'error');
    assert.equal(r.session.state.messages.at(-1)!.content, '');
    assert.equal(r.session.history.length, 0);
    assert.equal(r.session.local.state.reserved, false);
  }
});

test('topic search combines similarity and catalog fields before admitting three new records', async () => {
  const records = rows.map((row) => ({ ...row }));
  records[1]! = { ...records[1]!, sig: 'P', stars: 2, classification: 'Pathogenic' };
  records[2]! = { ...records[2]!, sig: 'P', stars: 3, classification: 'Pathogenic' };
  records[3]! = { ...records[3]!, sig: 'P', stars: 3, classification: 'Pathogenic' };
  const h = await harness([plan('search', 'synthetic topic')], [], records);
  await h.session.send('Find variants for this topic');
  assert.equal(h.session.state.error, null);
  const message = h.session.state.messages.at(-1)!,
    ranking = message!.journey!.steps.find((step) => step.id === 'semantic')!.data;
  assert.deepEqual(
    ranking!.rows!.slice(0, 3).map((hit) => hit.index),
    [1, 2, 3],
  );
  assert.deepEqual(
    message!.context!.evidence!.matches.map((record) => record.gene),
    ['FIXTURE2', 'FIXTURE3', 'FIXTURE4'],
  );
  assert.ok(
    ranking!.scores!.some((hit) => hit.index === 29),
    'Full pool is scored even outside the preview',
  );
});

test('opening receives only selected records; unfinished prose is never published or remembered', async () => {
  const h = await harness([plan('search', 'fixture')], [selected(['v2'])]);
  await h.session.send('Review a fixture');
  assert.equal(h.session.state.error, null);
  assert.equal(h.openingRequests.length, 1);
  const request = h.openingRequests[0]!;
  const payload = JSON.parse(request.messages.at(-1)!.content);
  assert.deepEqual(
    payload.reference.records.map((r: { gene: string }) => r.gene),
    ['FIXTURE2'],
  );
  assert.equal(payload.reference.records[0]!.id, undefined);
  assert.equal(payload.reference.records[0]!.origin, undefined);
  assert.equal(request.response_format, undefined);
  assert.deepEqual(request.extra_body, { enable_thinking: false });
  assert.equal(
    h.session.state.messages.at(-1)!.journey!.steps.find((s) => s.id === 'answer')!.data!.opening!
      .request!.messages[0]!.content,
    EVIDENCE_OPENING_PROMPT,
  );
  for (const opening of [
    { raw: 'Partial claim', finish: 'length' as const },
    { raw: '', finish: 'stop' as const },
  ]) {
    const failed = await harness([plan('search', 'fixture')], [selected(['v1'])], rows, opening);
    await failed.session.send('Review a fixture');
    assert.equal(failed.session.state.messages.at(-1)!.status, 'error');
    assert.equal(failed.session.state.messages.at(-1)!.content, '');
    assert.equal(failed.session.history.length, 0);
    assert.equal(failed.session.local.state.reserved, false);
  }
});
