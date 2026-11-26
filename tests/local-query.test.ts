import { buildCatalogSummary } from '../src/lib/catalog-summary.ts';
import type { ModelRequest, ModelChunk, MatchedRow, SearchPlan } from '../src/lib/types.ts';
import { fakeEngine, fakeSearch } from './helpers/inference.ts';
import test from 'node:test';
import { ANSWER_PROMPT } from '../src/prompts/answer.ts';
import assert from 'node:assert/strict';
import { LocalModelSession } from '../src/lib/local-model-session.ts';
import { EmbeddingsSession } from '../src/lib/embeddings-session.ts';
import { parseLocalQuery, buildLocalQueryContext } from '../src/lib/local-query.ts';
import {
  LOCAL_MIN_RESPONSE_TOKENS,
  LOCAL_TEMPLATE_RESERVE_TOKENS,
} from '../src/config/local-inference.ts';
import { QUERY_SCHEMA } from '../src/config/query-schema.ts';
import { buildEmbeddingsContext } from '../src/lib/embeddings-context.ts';
import { fitConversation } from '../src/lib/conversation-context.ts';
import { LOCAL_MODELS } from '../src/config/models/index.ts';

const plan = (query: string) => ({ query });
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
  plans: SearchPlan[],
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
          const planning = Boolean(request.response_format);
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
      summary: buildCatalogSummary(records),
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

test('query grammar and parser support both an overview and a search subject', () => {
  assert.deepEqual(
    QUERY_SCHEMA.anyOf.map((shape) => shape.required),
    [['overview'], ['query']],
  );
  const valid = plan('hearing loss');
  assert.deepEqual(parseLocalQuery(JSON.stringify(valid)), valid);
  assert.deepEqual(parseLocalQuery(JSON.stringify({ overview: true })), { overview: true });
  for (const invalid of [
    { overview: false },
    { overview: true, query: 'a topic' },
    {},
    { query: null },
    plan(''),
    plan('  '),
    plan('x'.repeat(1001)),
    { ...valid, mode: 'search' },
    { query: 42 },
    [],
    null,
  ]) {
    assert.throws(() => parseLocalQuery(JSON.stringify(invalid)), /invalid search plan/);
  }
  assert.throws(() => parseLocalQuery('invalid JSON'));
});

test('general questions and clarifications use the same search path, preserving history', async () => {
  const h = await harness(
    [plan('chromosome'), plan('chromosome explanation'), plan('allele')],
    [
      answer('A chromosome contains DNA.'),
      answer('DNA is packaged into chromosomes.'),
      answer('A new explanation.'),
    ],
  );
  await h.session.send('What is a chromosome?');
  await h.session.send('Explain that more simply.');
  assert.deepEqual(h.operations, ['score', 'score']);
  assert.deepEqual(h.requests[2]!.messages, [
    h.requests[0]!.messages[0],
    { role: 'user', content: 'What is a chromosome?' },
    { role: 'assistant', content: 'A chromosome contains DNA.' },
    { role: 'user', content: 'Explain that more simply.' },
  ]);
  assert.deepEqual(h.requests[3]!.messages.slice(1, -1), [
    { role: 'user', content: 'What is a chromosome?' },
    { role: 'assistant', content: 'A chromosome contains DNA.' },
  ]);
  assert.match(h.requests[3]!.messages.at(-1)!.content, /Question: Explain that more simply/);
  assert.equal(h.session.state.messages.at(-1)!.context!.included, 5);
  await h.session.send('What is an allele?');
  assert.equal(h.requests[5]!.messages.length, 6);
  assert.equal(h.session.state.error, null);
  assert.ok(h.session.history.every((turn) => !Object.hasOwn(turn, 'records')));
});

test('an oversized previous answer is omitted with its question, never partially copied', () => {
  const profile = { ...LOCAL_MODELS[0]!, contextWindowTokens: 8000 };
  const previous = [{ question: 'Earlier topic', answer: 'x'.repeat(9000) }];
  const c = buildEmbeddingsContext(
    'Explain it',
    [],
    { build: 'GRCh38', matches: [], issues: [] },
    profile,
    { query: 'explanation' },
    { history: previous },
  );
  assert.equal(c.historyTurns, 0);
  assert.equal(c.omittedHistoryTurns, 1);
  assert.equal(c.messages.length, 2);
  assert.ok(!JSON.stringify(c.messages).includes('Earlier topic'));
  assert.ok(!JSON.stringify(c.messages).includes('xxxx'));
});

test('the query grammar stays the same with or without fitted history', () => {
  const profile = { ...LOCAL_MODELS[0]!, contextWindowTokens: 8000 };
  for (const previous of [
    [],
    [{ question: 'Old', answer: 'x'.repeat(9000) }],
    [{ question: 'Old', answer: 'Brief answer' }],
  ]) {
    const c = buildLocalQueryContext('Tell me more', previous, profile, buildCatalogSummary(rows));
    assert.deepEqual(JSON.parse(c.generation.response_format!.schema!), QUERY_SCHEMA);
  }
});

test('both query planning and answering retain complete conversation across topics and overviews', async () => {
  const h = await harness(
    [{ overview: true }, plan('synthetic variant'), plan('new topic'), { overview: true }],
    [
      answer('A synthetic variant was discussed.'),
      answer('UNVERIFIED_INTERPRETATION_SENTINEL'),
      answer('New facts.'),
      answer('New overview.'),
    ],
  );
  await h.session.send('Overview');
  const first = h.session.state.messages.at(-1)!;
  assert.deepEqual(
    first.context!.evidence.matches.map((r) => r.gene),
    ['FIXTURE30', 'FIXTURE1', 'FIXTURE2'],
  );
  assert.equal(first.context!.evidence.coverage.currentTurn.retrieval, 'catalog_review');
  assert.match(h.requests[1]!.messages.at(-1)!.content, /Record order: catalog review priority/);
  await h.session.send('Tell me more about that variant');
  assert.deepEqual(h.operations, ['score']);
  assert.deepEqual(h.requests[3]!.messages.slice(1, -1), [
    { role: 'user', content: 'Overview' },
    { role: 'assistant', content: 'A synthetic variant was discussed.' },
  ]);
  await h.session.send('A new topic');
  for (const index of [4, 5])
    assert.ok(
      JSON.stringify(h.requests[index]!.messages).includes('UNVERIFIED_INTERPRETATION_SENTINEL'),
    );
  assert.equal(JSON.parse(h.requests[5]!.messages.at(-1)!.content.split('\n')[1]!).length, 5);
  await h.session.send('Overview again');
  assert.deepEqual(h.operations, ['score', 'score']);
  assert.equal(h.requests[7]!.messages.length, 8);
  assert.equal(h.session.state.messages.at(-1)!.context!.historyTurns, 3);
  assert.equal(h.session.state.error, null);
  h.session.clear();
  assert.equal(h.session.history.length, 0);
  assert.equal(h.session.state.messages.length, 0);
});

test('public and uploaded genome metadata do not change model requests for any question', async () => {
  const publicSession = await harness([
    plan('FIXTURE30'),
    plan('explanation'),
    plan('synthetic condition'),
    plan('general explanation'),
  ]);
  const uploadedSession = await harness([
    plan('FIXTURE30'),
    plan('explanation'),
    plan('synthetic condition'),
    plan('general explanation'),
  ]);
  uploadedSession.session.genome = {
    ...uploadedSession.session.genome,
    kind: 'upload',
    label: 'PRIVATE_FILENAME',
    name: 'PRIVATE_FILENAME',
    sha256: 'PRIVATE_DIGEST',
  };
  for (const h of [publicSession, uploadedSession]) {
    for (const question of ['Overview', 'Explain that', 'Synthetic condition?', 'What is DNA?']) {
      await h.session.send(question);
    }
    assert.equal(h.session.state.error, null);
    assert.equal(h.requests.length, 8);
    assert.doesNotMatch(JSON.stringify(h.requests), /genomeSource|PRIVATE_|GIAB HG002/);
  }
  assert.deepEqual(uploadedSession.requests, publicSession.requests);
});

test('newest complete turns fit the budget; older turns are dropped whole with no summary or question rules', () => {
  const profile = { ...LOCAL_MODELS[0]!, contextWindowTokens: 6500 };
  const previous = [0, 1, 2].map((i) => ({
    question: 'question ' + i,
    answer: String(i).repeat(1600),
    records: [],
  }));
  const c = buildLocalQueryContext(
    'Latest question',
    previous,
    {
      ...LOCAL_MODELS[0]!,
      contextWindowTokens: 9000,
    },
    buildCatalogSummary(rows),
  );
  assert.equal(c.historyTurns, 1);
  assert.equal(c.omittedHistoryTurns, 2);
  assert.deepEqual(c.messages.slice(1, -1), [
    { role: 'user', content: 'question 2' },
    { role: 'assistant', content: previous[2]!.answer },
  ]);
  assert.ok(c.inputBytes <= c.inputByteLimit);
  assert.equal(c.responseTokenLimit, 9000);
  const big = fitConversation(previous, profile, {
    system: 'Rules',
    question: 'Latest',
    generation: { response_format: { type: 'json_object' as const, schema: 'S'.repeat(1500) } },
  });
  assert.equal(big.historyTurns, 0, 'Schema size counts against the same budget');
  assert.throws(
    () => buildLocalQueryContext('x'.repeat(10000), [], profile, buildCatalogSummary(rows)),
    /context budget/,
  );
});

test('a complete turn fits at the exact UTF-8 byte limit and is omitted one byte below it', () => {
  const turn = { question: 'Café?', answer: '🧬' };
  const request = { system: 'Rules', question: 'Next', generation: {} };
  const inputBytes = Buffer.byteLength(
    request.system + request.question + turn.question + turn.answer,
  );
  const contextWindowTokens =
    LOCAL_MIN_RESPONSE_TOKENS + 3 * LOCAL_TEMPLATE_RESERVE_TOKENS + inputBytes;
  const profile = { ...LOCAL_MODELS[0]!, contextWindowTokens };
  const history = [{ question: 'Earlier', answer: 'Answer' }, turn];
  const exact = fitConversation(history, profile, request);
  assert.equal(exact.inputBytes, exact.inputByteLimit);
  assert.deepEqual(exact.messages.slice(1, -1), [
    { role: 'user', content: turn.question },
    { role: 'assistant', content: turn.answer },
  ]);
  const smaller = fitConversation(
    history,
    { ...profile, contextWindowTokens: contextWindowTokens - 1 },
    request,
  );
  assert.equal(smaller.omittedHistoryTurns, history.length);
});

test('a supplied topic triggers search regardless of question wording, with the same summary for both calls', async () => {
  for (const question of [
    'Which variants should I be most concerned about?',
    'Review hearing variants',
    'arbitrary wording',
  ]) {
    const h = await harness([plan('FIXTURE30')]);
    await h.session.send(question);
    assert.equal(h.session.state.error, null);
    assert.deepEqual(h.operations, ['score']);
    assert.equal(h.session.state.messages.at(-1)!.context!.evidence!.matches[0]!.gene, 'FIXTURE1');
    assert.equal(
      h.session.state.messages.at(-1)!.context!.evidence!.coverage.currentTurn.retrievedCandidates,
      30,
    );
    assert.equal(h.requests.length, 2);
    const summary = buildCatalogSummary(rows);
    const plannerMessages = h.requests[0]!.messages;
    assert.equal(plannerMessages.length, 2);
    assert.equal(plannerMessages[0]!.role, 'system');
    assert.ok(plannerMessages[0]!.content.startsWith(summary));
    assert.deepEqual(plannerMessages[1], { role: 'user', content: question });
    assert.ok(h.requests[1]!.messages.at(-1)!.content.includes(summary));
    assert.equal(
      h.session.state.messages.at(-1)!.journey!.steps.find((s) => s.id === 'query')!.data!
        .catalogSummary,
      buildCatalogSummary(rows),
    );
  }
});

test('all model profiles use the same query prompt, grammar and native context cap', () => {
  const previous = [{ question: 'Question', answer: 'Answer', records: [] }];
  const first = buildLocalQueryContext(
    'Follow up',
    previous,
    LOCAL_MODELS[0]!,
    buildCatalogSummary(rows),
  );
  for (const profile of LOCAL_MODELS) {
    const c = buildLocalQueryContext('Follow up', previous, profile, buildCatalogSummary(rows));
    assert.deepEqual(c.messages, first.messages);
    assert.deepEqual(c.generation, first.generation);
    assert.equal(c.responseTokenLimit, profile.contextWindowTokens);
  }
});

test('invalid plans fail visibly before semantic scoring or answering', async () => {
  const h = await harness([plan('   ')]);
  await h.session.send('Broad-looking wording');
  assert.match(h.session.state.error!.message, /invalid search plan/);
  assert.equal(h.preparations(), 1);
  assert.deepEqual(h.operations, []);
  assert.equal(h.requests.length, 1);
  assert.equal(h.session.history.length, 0);
});

test('unfinished answers never enter conversation history', async () => {
  const h = await harness(
    [plan('general explanation')],
    [{ raw: 'Incomplete text', finish: 'length' as const }],
  );
  await h.session.send('Explain a concept');
  assert.equal(h.session.state.messages.at(-1)!.status, 'error');
  assert.equal(h.session.history.length, 0);
  for (const reply of [
    { raw: 'Partial answer', finish: 'length' as const },
    { raw: '', finish: 'stop' as const },
  ]) {
    const r = await harness([plan('FIXTURE30')], [reply]);
    await r.session.send('Review my findings');
    assert.equal(r.session.state.messages.at(-1)!.status, 'error');
    assert.equal(r.session.state.messages.at(-1)!.content, '');
    assert.equal(r.session.history.length, 0);
    assert.equal(r.session.local.state.reserved, false);
  }
});

test('topic search uses similarity alone before admitting five candidates', async () => {
  const records = rows.map((row) => ({ ...row }));
  records[1]! = { ...records[1]!, sig: 'P', stars: 2, classification: 'Pathogenic' };
  records[2]! = { ...records[2]!, sig: 'P', stars: 3, classification: 'Pathogenic' };
  records[3]! = { ...records[3]!, sig: 'P', stars: 3, classification: 'Pathogenic' };
  const h = await harness([plan('synthetic topic')], [], records);
  await h.session.send('Find variants for this topic');
  assert.equal(h.session.state.error, null);
  const message = h.session.state.messages.at(-1)!,
    ranking = message!.journey!.steps.find((step) => step.id === 'semantic')!.data;
  assert.deepEqual(
    ranking!.rows!.slice(0, 5).map((hit) => hit.index),
    [0, 1, 2, 3, 4],
  );
  assert.deepEqual(
    message!.context!.evidence!.matches.map((record) => record.gene),
    records.slice(0, 5).map((row) => row.gene),
  );
  assert.ok(
    ranking!.scores!.some((hit) => hit.index === 29),
    'Full pool is scored even outside the preview',
  );
});

test('one answer call receives five candidates and publishes only the generated text', async () => {
  const response = 'Only the second candidate helps answer this question.';
  const h = await harness([plan('fixture')], [answer(response)]);
  await h.session.send('Review a fixture');
  assert.equal(h.session.state.error, null);
  assert.equal(h.requests.length, 2, 'One query call and one answer call; no selector');
  const request = h.requests[1]!;
  const records = JSON.parse(request.messages.at(-1)!.content.split('\n')[1]!);
  assert.deepEqual(
    records.map((r: { gene: { name: string } | null }) => r.gene?.name),
    rows.slice(0, 5).map((r) => r.gene),
  );
  assert.equal(request.response_format, undefined);
  assert.deepEqual(request.extra_body, { enable_thinking: false });
  assert.equal(request.messages[0]!.content, ANSWER_PROMPT);
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

test('answers retain generated Markdown as history and add fresh records; clear removes history', async () => {
  const response = 'One relevant finding: [FIXTURE2](https://example.com/record).';
  const h = await harness(
    [plan('fixture'), plan('explanation'), plan('new topic'), plan('general explanation')],
    [
      answer(response),
      answer('An explanation.'),
      answer('A new finding.'),
      answer('A fresh explanation.'),
    ],
  );
  await h.session.send('Find records');
  assert.equal(h.session.state.error, null);
  assert.deepEqual(h.session.history[0], {
    identity: h.session.history[0]!.identity,
    question: 'Find records',
    answer: response,
  });
  assert.equal(h.session.state.messages.at(-1)!.content, response);
  await h.session.send('Explain this record');
  const follow = h.requests[3]!;
  assert.deepEqual(follow.messages.slice(1, -1), [
    { role: 'user', content: 'Find records' },
    { role: 'assistant', content: response },
  ]);
  assert.equal(h.session.state.messages.at(-1)!.context!.recordReference.records.length, 5);
  assert.deepEqual(h.operations, ['score', 'score']);
  await h.session.send('A different topic');
  assert.equal(h.requests[5]!.messages.length, 6);
  assert.ok(!h.requests[5]!.messages.at(-1)!.content.includes(response));
  h.session.clear();
  assert.equal(h.session.history.length, 0);
  assert.equal(h.session.state.messages.length, 0);
  await h.session.send('General question');
  assert.equal(h.requests[7]!.messages.length, 2);
  assert.equal(h.session.state.messages.at(-1)!.context!.recordReference.records.length, 5);
  h.session.dispose();
});
