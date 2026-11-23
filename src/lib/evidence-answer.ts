import type { RecordField, RecordReference, SourceLink, GenomeProvenance } from './types.ts';
import type { compactMatch } from './match-reference.ts';
import type { PublicationLabels } from '../vendor/genomewalk/catalogues/publication-format.ts';

export interface RecordEvidence {
  matches: ReturnType<typeof compactMatch>[];
  earlierMatches?: ReturnType<typeof compactMatch>[];
  genomeSource?: GenomeProvenance | null;
  publicationLabels?: PublicationLabels;
}
import { geneSource } from './local-evidence.ts';

// Original source fields remain available in the model-input inspector.
export function buildRecordReference(evidence: RecordEvidence): RecordReference {
  const records: RecordReference['records'] = [];
  for (const [origin, matches] of [
    ['current', evidence.matches],
    ['earlier', evidence.earlierMatches ?? []],
  ] as const) {
    for (const record of matches) {
      const field = (
        label: string,
        value: string | null | (string | null)[],
        sources: SourceLink[] = [],
      ): RecordField => ({
        label,
        ...(Array.isArray(value) ? { items: value } : { text: value }),
        sources,
      });
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
        field('Review status', record.review, link('ClinVar')),
        field('Overall frequency', record.frequency.overall, link('gnomAD')),
        field('Highest population frequency', record.frequency.highestPopulation, link('gnomAD')),
        field(
          'Publications',
          publications.length
            ? `${publications.length} publication ${publications.length === 1 ? 'link is' : 'links are'} supplied; paper contents are not included in this reference.`
            : 'No publication links are supplied for this variant in the catalog reference.',
          publications.map((url) => {
            const id = new URL(url).pathname.split('/').filter(Boolean).at(-1)!;
            return { label: evidence.publicationLabels?.[id] || `PubMed ${id}`, url };
          }),
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
    ...(evidence.genomeSource ? { genomeSource: evidence.genomeSource } : {}),
    records,
  };
}

// Keep readable descriptions compact while preserving every source field and link.
export function buildAnswerReference(reference: RecordReference) {
  return {
    ...(reference.genomeSource ? { genomeSource: reference.genomeSource } : {}),
    records: reference.records.map((record) => {
      const variantIds = record.fields.find(
        ({ label }) => label === 'Variant ID (dbSNP)' || label === 'Variant IDs (dbSNP)',
      );
      const sources = new Map<string, SourceLink>();
      if (record.gene) {
        const gene = geneSource(record.gene);
        sources.set(gene.url, gene);
      }
      for (const field of record.fields)
        for (const source of field.sources) sources.set(source.url, source);
      return {
        gene: record.gene,
        variant_ids: variantIds?.sources.map((source) => source.label) ?? [],
        sources: [...sources.values()],
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
