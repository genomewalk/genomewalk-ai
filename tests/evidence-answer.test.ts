import { buildCatalogSummary } from '../src/lib/catalog-summary.ts';
import type { SearchPlan } from '../src/lib/types.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnswerContext } from '../src/lib/answer-context.ts';
import { buildLocalQueryContext } from '../src/lib/local-query.ts';
import { buildAnswerReference } from '../src/lib/evidence-answer.ts';
import { ANSWER_PROMPT } from '../src/prompts/answer.ts';
import { localModelRequest } from '../src/lib/local-model-request.ts';
import { QUERY_SCHEMA } from '../src/config/query-schema.ts';
import { LOCAL_MODELS } from '../src/config/models/index.ts';
import fixture from './fixtures/evidence.json' with { type: 'json' };

const plan: SearchPlan = { query: fixture.plan.query };
const rows = fixture.rows.map((row, i) => ({ ...row, citation: `C${i + 1}` }));
const result = { build: 'GRCh38', matches: rows, issues: [] };
const sourceLinks = (record: ReturnType<typeof buildAnswerReference>['records'][number]) =>
  [record.gene, ...record.variants, record.clinvar, record.gnomad, ...record.papers].filter(
    (source) => source !== null,
  );

const context = (candidates = rows) =>
  buildAnswerContext(fixture.question, candidates, result, LOCAL_MODELS[0]!, plan);

test('answer candidates preserve every source field and link without duplicate URLs', () => {
  const c = context([rows[0]!, rows[1]!, rows[3]!]);
  const before = structuredClone(c.recordReference);
  const reference = buildAnswerReference(c.recordReference);
  assert.equal(
    c.messages.at(-1)!.content,
    `Matched variant records:\n${JSON.stringify(reference.records)}\n\n${buildCatalogSummary(rows)}\n\nSearch topic: ${plan.query}\n\nQuestion: ${fixture.question}`,
  );
  assert.match(
    reference.records[0]!.description,
    /Catalog review group: Less-reviewed disease claims/,
  );
  assert.match(reference.records[1]!.description, /Catalog review group: Other ClinVar matches/);
  assert.deepEqual(c.recordReference, before);
  assert.equal(Object.hasOwn(reference, 'note'), false);
  assert.match(c.messages[0]!.content, /not mapped to individual conditions/);
  assert.match(c.messages[0]!.content, /no paper text/);
  for (const [index, original] of c.recordReference.records.entries()) {
    const record = reference.records[index]!;
    assert.equal(record.gene?.name ?? null, original.gene);
    assert.ok(record.description.includes(original.variant));
    for (const field of original.fields) {
      if (field.text) assert.ok(record.description.includes(field.text));
      for (const item of field.items ?? []) if (item) assert.ok(record.description.includes(item));
      for (const link of field.sources)
        assert.ok(sourceLinks(record).some((s) => s.link === link.url && s.name === link.label));
    }
    assert.equal(new Set(sourceLinks(record).map((s) => s.link)).size, sourceLinks(record).length);
    assert.equal(Object.hasOwn(record, 'id'), false, 'UI record IDs are not model instructions');
    assert.equal(Object.hasOwn(record, 'origin'), false);
  }
  assert.deepEqual(
    reference.records[1]!.variants.map((v) => v.name),
    ['rs757362953'],
  );
  assert.doesNotMatch(reference.records[1]!.description, /ClinVar ID:/);
  assert.ok(
    sourceLinks(reference.records[1]!).some(
      (source) => source.link === 'https://www.ncbi.nlm.nih.gov/clinvar/variation/575366/',
    ),
  );
  assert.match(reference.records[1]!.description, /0\.000949274%/);
  assert.match(reference.records[1]!.description, /0\.0171116%.*Middle Eastern/);
  assert.match(reference.records[0]!.description, /Likely pathogenic; protective/);
  assert.match(
    reference.records[1]!.description,
    /Uncertain significance \(2\); Likely benign \(1\)/,
  );
  assert.ok(
    sourceLinks(reference.records[2]!).some(
      (s) => s.link === 'https://pubmed.ncbi.nlm.nih.gov/19917125/',
    ),
  );
  assert.ok(sourceLinks(reference.records[0]!).some((s) => s.link.includes('/gene/?term=CDKN2B')));
});

test('publication links and absence remain source facts, never paper contents', () => {
  const c = context(rows.slice(0, 2).map((row, i) => ({ ...row, pmids: i ? '12345,67890' : '' })));
  const reference = buildAnswerReference(c.recordReference);
  assert.match(reference.records[0]!.description, /No publication links are supplied/);
  assert.match(
    reference.records[1]!.description,
    /2 publication links are supplied; paper contents are not included/,
  );
  assert.deepEqual(reference.records[1]!.papers, [
    { name: 'PubMed 12345', link: 'https://pubmed.ncbi.nlm.nih.gov/12345/' },
    { name: 'PubMed 67890', link: 'https://pubmed.ncbi.nlm.nih.gov/67890/' },
  ]);
});

test('prepared citation labels reach the answer and inspector without changing evidence or URLs', () => {
  const candidates = [{ ...rows[0]!, pmids: '12345,67890' }];
  const original = context(candidates);
  const labeled = buildAnswerContext(fixture.question, candidates, result, LOCAL_MODELS[0]!, plan, {
    publicationLabels: { '12345': 'Example et al., Journal 2020', '67890': null },
  });
  assert.deepEqual(labeled.consideredRows, original.consideredRows);
  const reference = buildAnswerReference(labeled.recordReference);
  const publications = labeled.recordReference.records[0]!.fields.find(
    (field) => field.label === 'Publications',
  )!;
  assert.deepEqual(publications.sources, [
    { label: 'Example et al., Journal 2020', url: 'https://pubmed.ncbi.nlm.nih.gov/12345/' },
    { label: 'PubMed 67890', url: 'https://pubmed.ncbi.nlm.nih.gov/67890/' },
  ]);
  assert.ok(
    sourceLinks(reference.records[0]!).some(
      (source) => source.name === publications.sources[0]!.label,
    ),
  );
  assert.doesNotMatch(reference.records[0]!.description, /PubMed ID:/);
  for (const source of publications.sources)
    assert.ok(
      sourceLinks(reference.records[0]!).some(
        (candidate) => candidate.name === source.label && candidate.link === source.url,
      ),
    );
  assert.match(labeled.messages.at(-1)!.content, /Example et al., Journal 2020/);
});

test('fresh answer inputs contain only the current candidates and preserve source details', () => {
  const c = context([rows[3]!]);
  assert.equal(c.messages.length, 2);
  assert.equal(c.recordReference.records.length, 1);
  const record = buildAnswerReference(c.recordReference).records[0]!;
  assert.ok(record.description.includes(c.recordReference.records[0]!.variant));
  assert.ok(sourceLinks(record).length);
});

test('answers share one prompt and use model defaults while query generation stays fixed', () => {
  const baseline = context();
  const history = [{ question: 'Earlier question', answer: 'Earlier answer' }];
  for (const model of LOCAL_MODELS) {
    const c = buildAnswerContext(fixture.question, rows, result, model, plan);
    assert.deepEqual(c.messages, baseline.messages);
    assert.deepEqual(c.generation, baseline.generation);
    const overview = buildAnswerContext('Overview', rows, result, model, {
      overview: true,
    });
    assert.equal(
      overview.messages.at(-1)!.content,
      `Matched variant records:\n${JSON.stringify(buildAnswerReference(overview.recordReference).records)}\n\n${buildCatalogSummary(rows)}\n\nRecord order: catalog review priority.\n\nQuestion: Overview`,
    );
    for (const answerContext of [
      c,
      overview,
      buildAnswerContext('Explain it', rows, result, model, plan, { history }),
      buildAnswerContext('What is DNA?', rows, result, model, plan, { history }),
    ]) {
      assert.equal(answerContext.messages[0]!.content, ANSWER_PROMPT);
      const request = localModelRequest(model, answerContext.messages, answerContext.generation);
      assert.equal(request.temperature, model.generation.temperature);
      assert.equal(request.top_p, model.generation.top_p);
      assert.equal(request.presence_penalty, model.generation.presence_penalty);
      assert.equal(request.repetition_penalty, model.generation.repetition_penalty);
      assert.equal(Object.hasOwn(request, 'seed'), false);
      assert.equal(request.response_format, undefined);
      assert.deepEqual(request.extra_body, model.extraBody);
      assert.equal(request.max_tokens, 2048);
      assert.equal(answerContext.responseTokenLimit, model.contextWindowTokens);
      assert.ok(answerContext.inputBytes <= answerContext.inputByteLimit);
    }
    for (const previous of [[], history]) {
      const route = buildLocalQueryContext(
        'Explain the records',
        previous,
        model,
        buildCatalogSummary(rows),
      );
      const request = localModelRequest(model, route.messages, route.generation);
      assert.equal(request.temperature, 0);
      assert.equal(request.top_p, 1);
      assert.equal(request.seed, 42);
      assert.equal(request.presence_penalty, 0);
      assert.equal(request.repetition_penalty, 1);
      assert.equal(request.max_tokens, 512);
      assert.deepEqual(request.extra_body, {});
      assert.deepEqual(JSON.parse(request.response_format!.schema!), QUERY_SCHEMA);
    }
  }
});

test('missing candidates remain an empty list rather than a negative genome finding', () => {
  const c = context([]);
  assert.equal(
    c.messages.at(-1)!.content,
    `Matched variant records:\n[]\n\n${buildCatalogSummary(rows)}\n\nSearch topic: ${plan.query}\n\nQuestion: ${fixture.question}`,
  );
  assert.equal(c.included, 0);
  assert.equal(c.recordReference.records.length, 0);
});

test('rsIDs and source URLs survive, while malformed or missing identifiers are not guessed', () => {
  const candidates = [
    { ...rows[0]!, rsids: '6413458' },
    { ...rows[1]!, rsids: '148559653|rs267607614|148559653|rs0|123/?private=value|not-an-rsid' },
    { ...rows[2]!, rsids: '', call: { ...rows[2]!.call, id: 'rs99999' } },
  ];
  const c = context(candidates);
  const reference = buildAnswerReference(c.recordReference);
  assert.deepEqual(
    reference.records[0]!.variants.map((v) => v.name),
    ['rs6413458'],
  );
  assert.deepEqual(
    reference.records[1]!.variants.map((v) => v.name),
    ['rs148559653', 'rs267607614'],
  );
  assert.deepEqual(
    reference.records[2]!.variants.map((v) => v.name),
    [],
  );
  const wire = JSON.stringify(reference);
  assert.ok(wire.includes('https://www.ncbi.nlm.nih.gov/snp/rs6413458'));
  assert.ok(wire.includes('https://www.ncbi.nlm.nih.gov/snp/rs267607614'));
  assert.ok(!wire.includes('private=value'));
  assert.ok(!wire.includes('rs99999'));
});
