import type { SearchPlan } from '../src/lib/types.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEmbeddingsContext } from '../src/lib/embeddings-context.ts';
import { buildAnswerReference } from '../src/lib/evidence-answer.ts';
import { localModelRequest } from '../src/lib/local-model-request.ts';
import { LOCAL_MODELS } from '../src/config/models/index.ts';
import fixture from './fixtures/evidence.json' with { type: 'json' };

const plan: SearchPlan = { mode: 'search', query: fixture.plan.query };
const rows = fixture.rows.map((row, i) => ({ ...row, citation: `C${i + 1}` }));
const result = { build: 'GRCh38', matches: rows, issues: [] };
const context = (candidates = rows) =>
  buildEmbeddingsContext(fixture.question, candidates, result, LOCAL_MODELS[0]!, plan);

test('answer candidates preserve every source field and link without duplicate URLs', () => {
  const c = context([rows[0]!, rows[1]!, rows[3]!]);
  const before = structuredClone(c.recordReference);
  const reference = buildAnswerReference(c.recordReference);
  assert.deepEqual(JSON.parse(c.messages.at(-1)!.content).reference, reference);
  assert.deepEqual(c.recordReference, before);
  assert.equal(Object.hasOwn(reference, 'note'), false);
  assert.match(c.messages[0]!.content, /not mapped to individual conditions/);
  assert.match(c.messages[0]!.content, /no paper text/);
  for (const [index, original] of c.recordReference.records.entries()) {
    const record = reference.records[index]!;
    assert.equal(record.gene, original.gene);
    assert.ok(record.description.includes(original.variant));
    for (const field of original.fields) {
      if (field.text) assert.ok(record.description.includes(field.text));
      for (const item of field.items ?? []) if (item) assert.ok(record.description.includes(item));
      for (const link of field.sources)
        assert.ok(record.sources.some((s) => s.url === link.url && s.label === link.label));
    }
    assert.equal(new Set(record.sources.map((s) => s.url)).size, record.sources.length);
    assert.equal(Object.hasOwn(record, 'id'), false, 'No selector-only IDs in the answer request');
    assert.equal(Object.hasOwn(record, 'origin'), false);
  }
  assert.deepEqual(reference.records[1]!.variant_ids, ['rs757362953']);
  assert.doesNotMatch(reference.records[1]!.description, /ClinVar ID:/);
  assert.ok(
    reference.records[1]!.sources.some(
      (source) => source.url === 'https://www.ncbi.nlm.nih.gov/clinvar/variation/575366/',
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
    reference.records[2]!.sources.some(
      (s) => s.url === 'https://pubmed.ncbi.nlm.nih.gov/19917125/',
    ),
  );
  assert.ok(reference.records[0]!.sources.some((s) => s.url.includes('/gene/?term=CDKN2B')));
});

test('publication links and absence remain source facts, never paper contents', () => {
  const c = context(rows.slice(0, 2).map((row, i) => ({ ...row, pmids: i ? '12345,67890' : '' })));
  const reference = buildAnswerReference(c.recordReference);
  assert.match(reference.records[0]!.description, /No publication links are supplied/);
  assert.match(
    reference.records[1]!.description,
    /2 publication links are supplied; paper contents are not included/,
  );
  assert.deepEqual(
    reference.records[1]!.sources.filter((s) => s.label.startsWith('PubMed')),
    [
      { label: 'PubMed 12345', url: 'https://pubmed.ncbi.nlm.nih.gov/12345/' },
      { label: 'PubMed 67890', url: 'https://pubmed.ncbi.nlm.nih.gov/67890/' },
    ],
  );
});

test('prepared citation labels reach the answer and inspector without changing evidence or URLs', () => {
  const candidates = [{ ...rows[0]!, pmids: '12345,67890' }];
  const original = context(candidates);
  const labeled = buildEmbeddingsContext(
    fixture.question,
    candidates,
    result,
    LOCAL_MODELS[0]!,
    plan,
    { publicationLabels: { '12345': 'Example et al., Journal 2020', '67890': null } },
  );
  assert.deepEqual(labeled.evidence, original.evidence);
  const reference = buildAnswerReference(labeled.recordReference);
  const publications = labeled.recordReference.records[0]!.fields.find(
    (field) => field.label === 'Publications',
  )!;
  assert.deepEqual(publications.sources, [
    { label: 'Example et al., Journal 2020', url: 'https://pubmed.ncbi.nlm.nih.gov/12345/' },
    { label: 'PubMed 67890', url: 'https://pubmed.ncbi.nlm.nih.gov/67890/' },
  ]);
  assert.ok(
    reference.records[0]!.sources.some((source) => source.label === publications.sources[0]!.label),
  );
  assert.doesNotMatch(reference.records[0]!.description, /PubMed ID:/);
  for (const source of publications.sources)
    assert.ok(
      reference.records[0]!.sources.some(
        (candidate) => candidate.label === source.label && candidate.url === source.url,
      ),
    );
  assert.match(labeled.messages.at(-1)!.content, /Example et al., Journal 2020/);
});

test('fresh answer inputs contain only the current candidates and preserve source details', () => {
  const c = context([rows[3]!]);
  assert.equal(c.messages.length, 2);
  assert.equal(c.recordReference.records.length, 1);
  assert.equal(c.recordReference.records[0]!.origin, 'current');
  const record = buildAnswerReference(c.recordReference).records[0]!;
  assert.ok(record.description.includes(c.recordReference.records[0]!.variant));
  assert.ok(record.sources.length);
});

test('all models share the direct-answer contract, sampling and available context budget', () => {
  const baseline = context();
  for (const model of LOCAL_MODELS) {
    const c = buildEmbeddingsContext(fixture.question, rows, result, model, plan);
    assert.deepEqual(c.messages, baseline.messages);
    assert.deepEqual(c.generation, baseline.generation);
    const request = localModelRequest(model, c.messages, c.generation);
    assert.equal(request.temperature, 0);
    assert.equal(request.top_p, 1);
    assert.equal(request.seed, 42);
    assert.equal(request.response_format, undefined);
    assert.deepEqual(request.extra_body, model.extraBody);
    assert.equal(request.max_tokens, 2048);
    assert.equal(c.responseTokenLimit, model.contextWindowTokens);
    assert.ok(c.inputBytes <= c.inputByteLimit);
  }
});

test('missing candidates remain an empty list rather than a negative genome finding', () => {
  const c = context([]);
  assert.deepEqual(JSON.parse(c.messages.at(-1)!.content).reference.records, []);
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
  assert.deepEqual(reference.records[0]!.variant_ids, ['rs6413458']);
  assert.deepEqual(reference.records[1]!.variant_ids, ['rs148559653', 'rs267607614']);
  assert.deepEqual(reference.records[2]!.variant_ids, []);
  const wire = JSON.stringify(reference);
  assert.ok(wire.includes('https://www.ncbi.nlm.nih.gov/snp/rs6413458'));
  assert.ok(wire.includes('https://www.ncbi.nlm.nih.gov/snp/rs267607614'));
  assert.ok(!wire.includes('private=value'));
  assert.ok(!wire.includes('rs99999'));
});
