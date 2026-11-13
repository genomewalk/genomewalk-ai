import { EVIDENCE_OPENING_PROMPT } from '../prompts/embeddings.js';
import { conversationMessages, fitConversation } from './conversation-context.js';
import { MAX_RECORDS, EVIDENCE_OPENING } from '../config/evidence-answer.js';

// A selected record always displays these same source fields. The model chooses
// records, not which source fields to hide.
export function buildRecordReference(evidence, { maxSelectedRecords = MAX_RECORDS } = {}) {
  if (!Number.isInteger(maxSelectedRecords) || maxSelectedRecords < 1 || maxSelectedRecords > 4)
    throw new Error('Selected-record limit must be an integer from 1 to 4.');
  const records = [];
  for (const [origin, matches] of [
    ['current', evidence.matches],
    ['earlier', evidence.earlierMatches ?? []],
  ]) {
    for (const record of matches) {
      const field = (label, value, sources = []) => ({
        label,
        ...(Array.isArray(value) ? { items: value } : { text: value }),
        sources,
      });
      const link = (name) =>
        record.sources[name] ? [{ label: name, url: record.sources[name] }] : [];
      const publications = record.sources.PubMed ?? [];
      const rsIds = record.sources.dbSNP ?? [];
      const fields = [
        ...(rsIds.length
          ? [field(rsIds.length === 1 ? 'Variant ID (dbSNP)' : 'Variant IDs (dbSNP)', null, rsIds)]
          : []),
        field('Genotype', record.yourCall),
        field('ClinVar classification', record.clinvar, link('ClinVar')),
        ...(record.conflictingClassifications?.length
          ? [field('Reported classifications', record.conflictingClassifications)]
          : []),
        ...(record.conditions.length
          ? [field('Listed conditions', record.conditions, link('ClinVar'))]
          : []),
        field('Review status', record.review, link('ClinVar')),
        field('Overall frequency', record.frequency.overall, link('gnomAD')),
        field('Highest population frequency', record.frequency.highestPopulation, link('gnomAD')),
        field(
          'Publications',
          publications.length
            ? `${publications.length} publication ${publications.length === 1 ? 'link is' : 'links are'} supplied; paper contents are not included in this reference.`
            : 'No publication links are supplied for this variant in the catalog reference.',
          publications.map((url, i) => ({ label: `PubMed ${i + 1}`, url })),
        ),
      ];
      records.push({
        id: `v${records.length + 1}`,
        origin,
        gene: record.gene,
        variant: record.variant,
        conditionClassifications: record.conditionClassifications,
        fields,
      });
    }
  }
  return {
    maxSelectedRecords,
    ...(evidence.genomeSource ? { genomeSource: evidence.genomeSource } : {}),
    records,
  };
}

export function selectionSchema(reference) {
  const ids = reference.records.map((record) => record.id);
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      selected: {
        type: 'array',
        items: { type: 'string', enum: ids.length ? ids : ['unavailable'] },
        maxItems: Math.min(reference.maxSelectedRecords ?? MAX_RECORDS, ids.length),
        uniqueItems: true,
      },
    },
    required: ['selected'],
  };
}

export function selectionGeneration(reference) {
  // Same JSON grammar configuration for every family. Full context/output cap
  // is retained; runtime thinking tags are not prepended outside the grammar.
  return {
    temperature: 0,
    top_p: 1,
    presence_penalty: 0,
    repetition_penalty: 1,
    extra_body: {},
    response_format: { type: 'json_object', schema: JSON.stringify(selectionSchema(reference)) },
  };
}

export function parseRecordSelection(raw, reference) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(
      'The local model returned invalid selection JSON. No answer was displayed. Please try again.',
    );
  }
  const allowed = new Set(reference.records.map((record) => record.id));
  if (
    !value ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== 'selected' ||
    !Array.isArray(value.selected) ||
    value.selected.length > (reference.maxSelectedRecords ?? MAX_RECORDS) ||
    value.selected.some((id) => typeof id !== 'string' || !allowed.has(id)) ||
    new Set(value.selected).size !== value.selected.length
  )
    throw new Error(
      'The local model returned an invalid evidence answer. No answer was displayed. Please try again.',
    );
  return value;
}

// Escape plain text for Markdown display. No semantic filtering or output repair.
const literal = (text) =>
  String(text ?? '')
    .replace(/[\\`*_{}[\]<>()!|#~>]/g, '\\$&')
    .replace(/[\r\n]+/g, ' ');
const links = (sources) =>
  sources.map(({ label, url }) => `[${literal(label)}](${url})`).join(' · ');
export function renderRecordSelection(selection, reference, opening = '') {
  parseRecordSelection(JSON.stringify(selection), reference);
  const selected = new Set(selection.selected);
  const fieldLine = (field) => {
    const label = `**${literal(field.label)}:**`;
    const sources = field.sources.length ? ` ${links(field.sources)}` : '';
    if (field.items)
      return `- ${label}${sources}\n${field.items.map((item) => `  - ${literal(item)}`).join('\n')}`;
    return `- ${label}${field.text ? ` ${literal(field.text)}` : ''}${sources}`;
  };
  const sections = reference.records
    .filter((record) => selected.has(record.id))
    .map(
      (record) =>
        `### ${literal(record.gene || 'Variant')}\n\n${literal(record.variant)}\n\n${record.fields.map(fieldLine).join('\n')}`,
    );
  const parts = opening ? [opening] : [];
  if (sections.length && reference.genomeSource?.kind === 'example')
    parts.push(
      `These results are from the **${literal(reference.genomeSource.label)} public example genome**.`,
    );
  else if (sections.length && reference.genomeSource?.kind === 'upload')
    parts.push('These results are from **the genome file you uploaded**.');
  if (sections.length) parts.push(sections.join('\n\n---\n\n'));
  return parts.join('\n\n');
}

// Draft from only the selected source records; internal IDs and rejected candidates
// never enter this reference. This ordinary Markdown call retains the profile's
// supported non-thinking configuration; no runtime prefix or prose is rewritten.
export function buildEvidenceOpeningContext(question, selection, reference, profile) {
  parseRecordSelection(JSON.stringify(selection), reference);
  const ids = new Set(selection.selected);
  const selectedReference = {
    ...(reference.genomeSource ? { genomeSource: reference.genomeSource } : {}),
    records: reference.records
      .filter((record) => ids.has(record.id))
      .map(({ id, origin, ...record }) => record),
  };
  return fitConversation([], profile, () => ({
    messages: conversationMessages(
      EVIDENCE_OPENING_PROMPT,
      JSON.stringify({ reference: selectedReference, latestQuestion: question }),
      [],
    ),
    generation: {
      max_tokens: EVIDENCE_OPENING.maxTokens,
      temperature: 0.2,
      top_p: 0.8,
      presence_penalty: 0,
      repetition_penalty: 1,
    },
  }));
}
