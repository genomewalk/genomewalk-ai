import type { RecordField, RecordReference, ReferenceRecord, SourceLink } from './types.ts';
import type { compactMatch } from './match-reference.ts';
import type { PublicationLabels } from '../vendor/genomewalk/catalogues/publication-format.ts';
import { geneSource } from './local-evidence.ts';

function field(
  label: string,
  value: string | null | (string | null)[],
  sources: SourceLink[] = [],
): RecordField {
  return {
    label,
    ...(Array.isArray(value) ? { items: value } : { text: value }),
    sources,
  };
}

// The inspector and the answer payload use the same source fields.
export function buildReferenceRecord(
  record: ReturnType<typeof compactMatch>,
  id: string,
  publicationLabels?: PublicationLabels,
): ReferenceRecord {
  const link = (name: 'ClinVar' | 'gnomAD'): SourceLink[] =>
    record.sources[name] ? [{ label: name, url: record.sources[name]! }] : [];
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
    field('Catalog review group', record.reviewGroup),
    field('Review status', record.review, link('ClinVar')),
    field('Overall frequency', record.frequency.overall, link('gnomAD')),
    field('Highest population frequency', record.frequency.highestPopulation, link('gnomAD')),
    field(
      'Publications',
      publications.length
        ? `${publications.length} publication ${publications.length === 1 ? 'link is' : 'links are'} supplied; paper contents are not included in this reference.`
        : 'No publication links are supplied for this variant in the catalog reference.',
      publications.map((url) => {
        const pmid = new URL(url).pathname.split('/').filter(Boolean).at(-1)!;
        return { label: publicationLabels?.[pmid] || `PubMed ${pmid}`, url };
      }),
    ),
  ];
  return {
    id,
    gene: record.gene,
    variant: record.variant,
    fields,
  };
}

// Keep readable descriptions compact while preserving every source field and link.
export function buildAnswerReference(reference: RecordReference) {
  return {
    records: reference.records.map((record) => {
      const variantIds = record.fields.find(
        ({ label }) => label === 'Variant ID (dbSNP)' || label === 'Variant IDs (dbSNP)',
      );
      const namedLink = ({ label, url }: SourceLink) => ({ name: label, link: url });
      const links = (label: string) =>
        record.fields.find((field) => field.label === label)?.sources.map(namedLink) ?? [];
      return {
        gene: record.gene ? namedLink(geneSource(record.gene)) : null,
        variants: variantIds?.sources.map(namedLink) ?? [],
        clinvar: links('ClinVar classification')[0] ?? null,
        gnomad: links('Overall frequency')[0] ?? null,
        papers: links('Publications'),
        description: [
          record.variant,
          ...record.fields
            .filter((field) => field !== variantIds)
            .map((field) =>
              field.items
                ? `${field.label}: ${field.items.join('; ')}.`
                : `${field.label}: ${field.text}`,
            ),
        ].join(' '),
      };
    }),
  };
}
