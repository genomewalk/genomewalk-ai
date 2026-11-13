import { compactMatch } from '../src/lib/match-reference.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEmbeddingsContext } from '../src/lib/embeddings-context.js';
import {
  parseRecordSelection,
  renderRecordSelection,
  selectionSchema,
  buildEvidenceOpeningContext,
} from '../src/lib/evidence-answer.js';
import { LOCAL_MODELS } from '../src/config/models/index.js';
import fixture from './fixtures/evidence.json' with { type: 'json' };

const context = (plan = fixture.plan, rows = fixture.rows, previous = []) =>
  buildEmbeddingsContext(
    fixture.question,
    rows,
    { matches: fixture.rows, issues: [] },
    LOCAL_MODELS[0],
    plan,
    previous,
  );
const parse = (value, reference) =>
  parseRecordSelection(typeof value === 'string' ? value : JSON.stringify(value), reference);
const field = (record, label) => record.fields.find((f) => f.label === label);

test('a short answer precedes complete source sections with exact fields, in review order', () => {
  const c = context();
  const [mixed, conflict] = c.recordReference.records;
  assert.equal(mixed.conditionClassifications, null);
  assert.match(field(mixed, 'ClinVar classification').text, /Likely pathogenic; protective/);
  assert.deepEqual(field(conflict, 'Reported classifications').items, [
    'Uncertain significance (2)',
    'Likely benign (1)',
  ]);
  assert.match(field(conflict, 'Overall frequency').text, /0.000949274%.*overall/);
  assert.match(field(conflict, 'Highest population frequency').text, /0.0171116%.*Middle Eastern/);
  const selection = { selected: ['v2', 'v1'] },
    opening = 'These two records list cancer-related conditions.';
  const before = structuredClone(selection);
  const output = renderRecordSelection(selection, c.recordReference, opening);
  assert.deepEqual(selection, before, 'Rendering never changes the model selection');
  assert.ok(output.startsWith(opening + '\n\n### '));
  assert.ok(output.indexOf('CDKN2B') < output.indexOf('PDGFRA'), 'Review order is preserved');
  assert.ok(output.includes('### CDKN2B\n\n' + mixed.variant));
  assert.equal(JSON.parse(c.messages[1].content).reference.records[0].variant, mixed.variant);
  assert.deepEqual(
    JSON.parse(c.messages[1].content).scope,
    fixture.plan,
    'The selector receives the same resolved scope used for retrieval',
  );
  for (const label of [
    'Genotype',
    'ClinVar classification',
    'Listed conditions',
    'Review status',
    'Overall frequency',
    'Highest population frequency',
    'Publications',
  ]) {
    assert.equal(
      output.split(`**${label}:**`).length - 1,
      2,
      `${label} appears once for each record`,
    );
  }
  assert.equal(output.split('Uncertain significance \\(2\\)').length - 1, 1);
  assert.ok(output.includes('0.000949274%'));
  assert.match(output, /Middle Eastern/);
  assert.match(output, /gnomAD/);
  assert.ok(!output.includes('Personal disease risk'));
});

test('schema accepts only valid whole-record IDs without prose or legacy fields', () => {
  const r = context().recordReference;
  assert.deepEqual(selectionSchema(r).properties.selected.items.enum, ['v1', 'v2', 'v3']);
  assert.deepEqual(selectionSchema(r).required, ['selected']);
  const valid = { selected: [] };
  for (const value of [
    { selected: ['v1.annotation'] },
    { selected: ['v999'] },
    { selected: ['v1', 'v1'] },
    { selected: [null] },
    { ...valid, answer: 'Unexpected prose' },
    { ...valid, limitation: 'none' },
    {},
    '```json\n' + JSON.stringify(valid) + '\n```',
    '<think></think>' + JSON.stringify(valid),
  ])
    assert.throws(() => parse(value, r));
  assert.deepEqual(parse(valid, r), valid);
});

test('opening context contains only chosen source records, no IDs, and shared rules across models', () => {
  const reference = context().recordReference;
  const selection = { selected: ['v2'] };
  const first = buildEvidenceOpeningContext('Explain this', selection, reference, LOCAL_MODELS[0]);
  for (const model of LOCAL_MODELS) {
    const c = buildEvidenceOpeningContext('Explain this', selection, reference, model);
    assert.deepEqual(c.messages, first.messages);
    assert.deepEqual(c.generation, first.generation);
    assert.equal(c.messages.length, 2);
    assert.equal(c.generation.max_tokens, 256);
    assert.equal(c.generation.response_format, undefined);
    assert.equal(c.generation.extra_body, undefined);
    const payload = JSON.parse(c.messages.at(-1).content);
    assert.equal(payload.scope, undefined, 'A search rewrite is not evidence for the opening');
    const supplied = payload.reference.records;
    assert.equal(supplied.length, 1);
    assert.equal(supplied[0].gene, 'PDGFRA');
    assert.equal(supplied[0].id, undefined);
    assert.equal(supplied[0].origin, undefined);
    assert.deepEqual(supplied[0].fields, reference.records[1].fields);
    assert.ok(c.inputBytes <= c.inputByteLimit);
  }
  const opening = 'A brief **answer** from the supplied fields.';
  assert.ok(renderRecordSelection(selection, reference, opening).startsWith(opening));
  // Source fields are copied; generated prose is displayed through the ordinary
  // safe Markdown renderer without semantic repairs or a claim of validation.
  const unsupported = 'An unsupported assertion for this test.';
  assert.ok(renderRecordSelection(selection, reference, unsupported).startsWith(unsupported));
});

test('every supplied publication link is displayed; missing links never imply supplied paper contents', () => {
  const rows = fixture.rows
    .slice(0, 2)
    .map((row, i) => ({ ...row, pmids: i ? '12345,67890' : '' }));
  const reference = context(fixture.plan, rows).recordReference;
  const missing = field(reference.records[0], 'Publications');
  const linked = field(reference.records[1], 'Publications');
  assert.equal(
    missing.text,
    'No publication links are supplied for this variant in the catalog reference.',
  );
  assert.equal(
    linked.text,
    '2 publication links are supplied; paper contents are not included in this reference.',
  );
  assert.deepEqual(missing.sources, []);
  assert.deepEqual(
    linked.sources.map((s) => s.url),
    ['https://pubmed.ncbi.nlm.nih.gov/12345/', 'https://pubmed.ncbi.nlm.nih.gov/67890/'],
  );
  const withoutLinks = renderRecordSelection(
    { selected: ['v1'] },
    reference,
    'The supplied reference does not include paper contents or conclusions.',
  );
  assert.ok(withoutLinks.includes(missing.text));
  assert.ok(
    withoutLinks.includes('The supplied reference does not include paper contents or conclusions.'),
  );
  assert.ok(!withoutLinks.includes('pubmed.ncbi.nlm.nih.gov'));
  const withLinks = renderRecordSelection(
    { selected: ['v2'] },
    reference,
    'The record supplies publication links.',
  );
  for (const source of linked.sources) assert.ok(withLinks.includes(source.url));
  assert.ok(!withLinks.includes('No publication links'));
});

test('no evidence allows only an empty record selection, not a negative genome screen', () => {
  const r = context(fixture.plan, []).recordReference;
  assert.equal(selectionSchema(r).properties.selected.maxItems, 0);
  assert.throws(() => parse({ selected: ['unavailable'] }, r));
  assert.equal(
    renderRecordSelection({ selected: [] }, r, 'I could not answer that from the supplied facts.'),
    'I could not answer that from the supplied facts.',
  );
});

test('follow-ups preserve complete source sections; earlier prose stays outside the source reference', () => {
  const initial = context(fixture.plan, [fixture.rows[3]]);
  const previous = [
    {
      question: 'Review BLM',
      answer: 'INVENTED_PATHOGENIC_VOTE',
      records: initial.evidence.matches,
    },
  ];
  const follow = context({ mode: 'search', query: 'BLM' }, [], previous);
  assert.ok(JSON.stringify(follow.messages).includes('INVENTED_PATHOGENIC_VOTE'));
  assert.ok(!JSON.stringify(follow.recordReference).includes('INVENTED_PATHOGENIC_VOTE'));
  const papers = field(follow.recordReference.records[0], 'Publications');
  assert.equal(papers.sources.length, compactMatch(fixture.rows[3]).sources.PubMed.length);
  const selection = { selected: ['v1'] };
  assert.equal(
    renderRecordSelection(selection, initial.recordReference),
    renderRecordSelection(selection, follow.recordReference),
  );
});

test('all models share the record-selection contract and full configured context', () => {
  for (const model of LOCAL_MODELS) {
    const c = buildEmbeddingsContext(
      fixture.question,
      fixture.rows,
      { matches: fixture.rows, issues: [] },
      model,
      fixture.plan,
    );
    assert.equal(c.messages[0].content, context().messages[0].content);
    assert.deepEqual(c.generation, context().generation);
    assert.equal(c.generation.temperature, 0);
    assert.deepEqual(c.generation.extra_body, {});
    assert.ok(!Object.hasOwn(c.generation, 'max_tokens'));
    assert.equal(c.responseTokenLimit, model.contextWindowTokens);
    assert.ok(c.inputBytes <= c.inputByteLimit);
  }
});

test('three-record output limit includes earlier evidence without silently changing selections', () => {
  const first = context();
  const c = context(fixture.plan, fixture.rows.slice(2), [
    { question: 'Prior', answer: 'Prior cards', records: first.evidence.matches },
  ]);
  assert.equal(c.recordReference.records.length, 4);
  assert.equal(selectionSchema(c.recordReference).properties.selected.maxItems, 3);
  assert.throws(() => parse({ selected: ['v1', 'v2', 'v3', 'v4'] }, c.recordReference));
  const chosen = { selected: ['v1', 'v3'] };
  assert.deepEqual(parse(chosen, c.recordReference), chosen);
  const output = renderRecordSelection(chosen, c.recordReference);
  assert.equal(output.split('**Overall frequency:**').length - 1, 2);
  assert.equal(output.split('**ClinVar classification:**').length - 1, 2);
});

test('catalog rsIDs reach answer details and model reference as dbSNP links; missing or malformed IDs are never guessed', () => {
  const rows = [
    { ...fixture.rows[0], rsids: '6413458' },
    {
      ...fixture.rows[1],
      rsids: '148559653|rs267607614|148559653|rs0|123/?private=value|not-an-rsid',
    },
    { ...fixture.rows[2], rsids: '', call: { ...fixture.rows[2].call, id: 'rs99999' } },
  ];
  const c = context(fixture.plan, rows);
  const [single, multi, missing] = c.recordReference.records;
  assert.deepEqual(field(single, 'Variant ID (dbSNP)').sources, [
    { label: 'rs6413458', url: 'https://www.ncbi.nlm.nih.gov/snp/rs6413458' },
  ]);
  assert.deepEqual(
    field(multi, 'Variant IDs (dbSNP)').sources.map((s) => s.label),
    ['rs148559653', 'rs267607614'],
  );
  assert.ok(!missing.fields.some((f) => f.label.includes('dbSNP')));
  const output = renderRecordSelection({ selected: ['v1', 'v2', 'v3'] }, c.recordReference);
  assert.ok(output.includes('[rs6413458](https://www.ncbi.nlm.nih.gov/snp/rs6413458)'));
  assert.ok(output.includes('[rs267607614](https://www.ncbi.nlm.nih.gov/snp/rs267607614)'));
  assert.ok(!output.includes('private=value'));
  assert.ok(!output.includes('rs99999'));
  const opening = buildEvidenceOpeningContext(
    'Which IDs are these?',
    { selected: ['v1'] },
    c.recordReference,
    LOCAL_MODELS[0],
  );
  assert.ok(opening.messages.at(-1).content.includes('https://www.ncbi.nlm.nih.gov/snp/rs6413458'));
  const follow = context(
    { mode: 'search', query: 'APOB' },
    [],
    [{ question: 'Prior', answer: output, records: c.evidence.matches }],
  );
  assert.deepEqual(
    field(follow.recordReference.records[0], 'Variant ID (dbSNP)'),
    field(single, 'Variant ID (dbSNP)'),
  );
});
