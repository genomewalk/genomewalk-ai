import type { ModelRequest, ModelChunk, MatchedRow } from '../src/lib/types.ts';
import { fakeEngine, fakeSearch } from './helpers/inference.ts';
import test from 'node:test';
import { EMBEDDINGS_ANSWER_PROMPT } from '../src/prompts/embeddings.ts';
import assert from 'node:assert/strict';
import { LocalModelSession } from '../src/lib/local-model-session.ts';
import { EmbeddingsSession } from '../src/lib/embeddings-session.ts';
import { parseLocalQuery, buildLocalQueryContext } from '../src/lib/local-query.ts';
import { QUERY_SCHEMA } from '../src/config/search-scope.ts';
import { buildGeneralContext } from '../src/lib/general-context.ts';
import { conversationMessages, fitConversation } from '../src/lib/conversation-context.ts';
import { LOCAL_MODELS } from '../src/config/models/index.ts';

const plan = (mode: string, query = '') => ({ mode, query });
const answer = (raw: string) => ({ raw, finish: 'stop' as const });

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
) {
  const requests: ModelRequest[] = [];
  const operations: string[] = [];
  const local = new LocalModelSession({
    modelId: 'qwen3-4b',
    checkSupport: async () => 'test',
    createEngine: async () =>
      fakeEngine({
        async reset() {},
        dispose() {},
        async *complete(request) {
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
                raw: 'These records contain the requested annotations.',
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
  return { session, requests, operations, preparations: () => preparations };
}

test('exactly four categories; removed routes and extra routing fields are rejected', () => {
  assert.deepEqual(
    QUERY_SCHEMA.anyOf.map((b) => b.properties.mode.enum[0]!),
    ['search', 'overview', 'other', 'followup'],
  );
  for (const value of [
    plan('search', 'hearing'),
    plan('overview'),
    plan('other'),
    plan('followup'),
  ]) {
    assert.deepEqual(parseLocalQuery(JSON.stringify(value)), value);
  }
  for (const value of [
    plan('search'),
    plan('overview', 'topic'),
    plan('other', 'topic'),
    plan('followup', 'topic'),
    ...['reuse', 'educate', 'clarify', 'unresolved', 'invalid'].map((mode) => plan(mode)),
    { ...plan('search', 'hearing'), usePreviousEvidence: true },
    { ...plan('other'), clarification: 'Which?' },
    [],
  ]) {
    assert.throws(() => parseLocalQuery(JSON.stringify(value)), /invalid search plan/);
  }
  assert.throws(() => parseLocalQuery('```json\n{}\n```'));
});

test('General starts fresh; Follow-up receives conversation only without preparing or searching records', async () => {
  const h = await harness(
    [plan('other'), plan('followup'), plan('other')],
    [
      answer('A chromosome contains DNA.'),
      answer('DNA is packaged into chromosomes.'),
      answer('A new explanation.'),
    ],
  );
  h.session.fetch = () => {
    throw new Error('Must not request genome data');
  };
  await h.session.send('What is a chromosome?');
  await h.session.send('Explain that more simply.');
  assert.equal(h.preparations(), 0);
  assert.deepEqual(h.operations, []);
  const follow = h.requests[3]!;
  assert.deepEqual(follow.messages.slice(1, -1), [
    { role: 'user', content: 'What is a chromosome?' },
    { role: 'assistant', content: 'A chromosome contains DNA.' },
  ]);
  const payload = JSON.parse(follow.messages.at(-1)!.content);
  assert.equal(payload.latestQuestion, 'Explain that more simply.');
  assert.equal(payload.reference, undefined);
  assert.equal(h.session.state.messages.at(-1)!.context!.historyTurns, 1);
  await h.session.send('What is an allele?');
  assert.equal(h.requests[5]!.messages.length, 2);
  assert.equal(h.requests[5]!.messages.at(-1)!.content, 'What is an allele?');
  assert.equal(h.session.state.error, null);
  assert.ok(h.session.history.every((turn) => !Object.hasOwn(turn, 'records')));
  for (const profile of LOCAL_MODELS) {
    assert.equal(buildGeneralContext('New', h.session.history, profile).historyTurns, 0);
  }
});

test('clarification is an ordinary General answer; routing sees history but a fresh search answer does not', async () => {
  const h = await harness(
    [plan('other'), plan('search', 'hearing variants')],
    [
      { raw: 'Which topic or finding do you mean?', finish: 'stop' as const },
      answer('The first candidate is relevant.'),
    ],
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
  assert.equal(h.requests[3]!.messages.length, 2);
  h.session.clear();
  assert.deepEqual(h.session.history, []);
});

test('an oversized previous answer is omitted with its question, never partially copied', () => {
  const profile = { ...LOCAL_MODELS[0]!, contextWindowTokens: 8000 };
  const previous = [{ question: 'Earlier topic', answer: 'x'.repeat(9000) }];
  const c = buildGeneralContext('Explain it', previous, profile, { followup: true });
  assert.equal(c.historyTurns, 0);
  assert.equal(c.omittedHistoryTurns, 1);
  assert.equal(c.messages.length, 2);
  assert.ok(!JSON.stringify(c.messages).includes('Earlier topic'));
  assert.ok(!JSON.stringify(c.messages).includes('xxxx'));
});

test('routing cannot choose Follow-up when no complete earlier exchange fits', () => {
  const profile = { ...LOCAL_MODELS[0]!, contextWindowTokens: 8000 };
  const modes = (previous: { question: string; answer: string }[]) => {
    const c = buildLocalQueryContext('Tell me more', previous, profile);
    return JSON.parse(c.generation.response_format!.schema!).anyOf.map(
      (branch: { properties: { mode: { enum: string[] } } }) => branch.properties.mode.enum[0],
    );
  };
  assert.ok(!modes([]).includes('followup'));
  assert.ok(!modes([{ question: 'Old', answer: 'x'.repeat(9000) }]).includes('followup'));
  assert.ok(modes([{ question: 'Old', answer: 'Brief answer' }]).includes('followup'));
});

test('routing sees history; fresh searches and overviews do not; Follow-up has no source payload', async () => {
  const h = await harness(
    [plan('overview'), plan('followup'), plan('search', 'new topic'), plan('overview')],
    [
      answer('A synthetic variant was discussed.'),
      answer('UNVERIFIED_INTERPRETATION_SENTINEL'),
      answer('New facts.'),
      answer('New overview.'),
    ],
  );
  await h.session.send('Overview');
  await h.session.send('Tell me more about that variant');
  assert.equal(h.preparations(), 1, 'Follow-up does not prepare an index');
  assert.deepEqual(h.operations, [], 'Overview and Follow-up do not run semantic search');
  assert.deepEqual(h.requests[3]!.messages.slice(1, -1), [
    { role: 'user', content: 'Overview' },
    { role: 'assistant', content: 'A synthetic variant was discussed.' },
  ]);
  assert.equal(JSON.parse(h.requests[3]!.messages.at(-1)!.content).reference, undefined);
  await h.session.send('A new topic');
  assert.ok(JSON.stringify(h.requests[4]!.messages).includes('UNVERIFIED_INTERPRETATION_SENTINEL'));
  assert.equal(h.requests[5]!.messages.length, 2);
  assert.ok(
    !JSON.stringify(h.requests[5]!.messages).includes('UNVERIFIED_INTERPRETATION_SENTINEL'),
  );
  assert.equal(JSON.parse(h.requests[5]!.messages.at(-1)!.content).reference.records.length, 3);
  await h.session.send('Overview again');
  assert.equal(h.requests[7]!.messages.length, 2);
  assert.equal(h.session.state.error, null);
  h.session.clear();
  assert.deepEqual(h.session.history, []);
  assert.deepEqual(h.session.state.messages, []);
});

test('newest complete turns fit the budget; older turns are dropped whole with no summary or question rules', () => {
  const profile = { ...LOCAL_MODELS[0]!, contextWindowTokens: 6500 };
  const previous = [0, 1, 2].map((i) => ({
    question: 'question ' + i,
    answer: String(i).repeat(1600),
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
    { role: 'assistant', content: previous[2]!.answer },
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

test('all model profiles use the same four-category prompt, grammar and native context cap', () => {
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

test('unfinished answers never enter conversation history', async () => {
  const h = await harness([plan('other')], [{ raw: 'Incomplete text', finish: 'length' as const }]);
  await h.session.send('Explain a concept');
  assert.equal(h.session.state.messages.at(-1)!.limited, true);
  assert.equal(h.session.history.length, 0);
  for (const reply of [
    { raw: 'Partial answer', finish: 'length' as const },
    { raw: '', finish: 'stop' as const },
  ]) {
    const r = await harness([plan('overview')], [reply]);
    await r.session.send('Review my findings');
    assert.equal(r.session.state.messages.at(-1)!.status, 'error');
    assert.equal(r.session.state.messages.at(-1)!.content, '');
    assert.equal(r.session.history.length, 0);
    assert.equal(r.session.local.state.reserved, false);
  }
});

test('topic search uses similarity alone before admitting three candidates', async () => {
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
    [0, 1, 2],
  );
  assert.deepEqual(
    message!.context!.evidence!.matches.map((record) => record.gene),
    records.slice(0, 3).map((row) => row.gene),
  );
  assert.ok(
    ranking!.scores!.some((hit) => hit.index === 29),
    'Full pool is scored even outside the preview',
  );
});

test('one answer call receives three candidates and publishes only the generated text', async () => {
  const response = 'Only the second candidate helps answer this question.';
  const h = await harness([plan('search', 'fixture')], [answer(response)]);
  await h.session.send('Review a fixture');
  assert.equal(h.session.state.error, null);
  assert.equal(h.requests.length, 2, 'One routing call and one answer call; no selector');
  const request = h.requests[1]!;
  const payload = JSON.parse(request.messages.at(-1)!.content);
  assert.deepEqual(
    payload.reference.records.map((r: { gene: string }) => r.gene),
    rows.slice(0, 3).map((r) => r.gene),
  );
  assert.equal(request.response_format, undefined);
  assert.deepEqual(request.extra_body, { enable_thinking: false });
  assert.equal(request.messages[0]!.content, EMBEDDINGS_ANSWER_PROMPT);
  assert.equal(
    h.session.state.messages.at(-1)!.content,
    response,
    'No candidate cards are appended',
  );
  assert.equal(h.session.history[0]!.answer, response);
  assert.equal(
    h.session.state.messages.at(-1)!.journey!.steps.find((s) => s.id === 'answer')!.data!.raw,
    response,
  );
});
