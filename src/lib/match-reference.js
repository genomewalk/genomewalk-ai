import { condList } from './genomewalk/conditions.js';
import { matchForLocalModel } from './local-evidence.js';

const readable = (value) => value?.replaceAll('_', ' ').trim() || null;
const percent = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumSignificantDigits: 21,
  useGrouping: false,
});
const position = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function describeVariant(variant) {
  // VCF POS is the first reference base in the record; indels may include an
  // anchor base. Describe the recorded location and alleles without inferring
  // a mutation direction, affected base range or protein consequence.
  return `This variant is recorded on chromosome ${variant.chromosome} at position ${position.format(variant.position)} in the ${variant.build} reference genome. The reference allele is ${variant.referenceAllele}; the matched allele in the selected file is ${variant.matchedAllele}.`;
}

function allelePercentage(value) {
  if (
    !['number', 'string'].includes(typeof value) ||
    String(value).trim() === '' ||
    !Number.isFinite(Number(value)) ||
    Number(value) < 0 ||
    Number(value) > 1
  )
    return null;
  // Intl formats the catalog's decimal string directly. Avoid binary float
  // multiplication and the display UI's rounding, including for tiny values.
  return percent.format(value);
}

function describeCall(genotype, allele) {
  const observed = genotype.alleles?.length
    ? `The selected file contains ${genotype.alleles.join(' and ')}.`
    : 'The observed alleles are not supplied.';
  const copies = genotype.matchedAlleleCopies;
  const count =
    Number.isInteger(copies) && copies >= 0
      ? `This call has ${copies} ${copies === 1 ? 'copy' : 'copies'} of the ClinVar ${allele} allele.`
      : `The copy count for the ClinVar ${allele} allele is not supplied.`;
  const zygosity = {
    heterozygous: 'The call is heterozygous (two different alleles).',
    homozygous: 'The call is homozygous (two identical alleles).',
    haploid_call: 'This is a haploid call (one called allele).',
    unknown: 'Zygosity is not established.',
  }[genotype.zygosity];
  return `${observed} ${count} ${zygosity}`;
}

// Shared by every Local + Embeddings model and its request inspector. Each
// sentence describes explicit fields; no clinical inference, frequency tiers,
// gene-specific rules, generated summary or output rewriting is applied.
export function compactMatch(row) {
  const match = matchForLocalModel(row, row.build ?? 'GRCh38');
  const { variant, genotype, clinvar, populationFrequency, sources } = match;
  const classification = readable(clinvar.classification)?.split('|').join('; ');
  const knownStars =
    Number.isInteger(clinvar.reviewStars) && clinvar.reviewStars >= 0 && clinvar.reviewStars <= 4;
  const stars = knownStars
    ? `${clinvar.reviewStars} ${clinvar.reviewStars === 1 ? 'star' : 'stars'}`
    : 'Review stars not supplied';
  const overall = allelePercentage(row.af);
  const highest = allelePercentage(row.afmax);
  const population = readable(populationFrequency.maximumPopulation);
  return {
    gene: variant.gene,
    variant: describeVariant(variant),
    yourCall: describeCall(genotype, variant.matchedAllele),
    clinvar: classification
      ? `“${classification}” for the ${variant.matchedAllele} allele.`
      : `Not supplied for the ${variant.matchedAllele} allele.`,
    ...(clinvar.conflictingClassifications
      ? { conflictingClassifications: clinvar.conflictingClassifications.split('|').map(readable) }
      : {}),
    conditions: condList(readable(clinvar.conditions) ?? ''),
    // Genomewalk's prepared VCF catalog keeps CLNSIG and CLNDN separately.
    // No per-condition assertion mapping is supplied. Never zip the lists,
    // infer a Cartesian product, or invent current/somatic/germline assertions.
    conditionClassifications: null,
    review: `${stars}: ${readable(clinvar.reviewStatus) ?? 'review status not supplied'}.`,
    frequency: {
      overall:
        overall === null
          ? 'Overall allele frequency is not supplied.'
          : `The ${variant.matchedAllele} allele accounts for ${overall} of allele copies overall in the gnomAD reference data.`,
      highestPopulation:
        highest === null
          ? 'Highest-population allele frequency is not supplied.'
          : `The highest reported population frequency is ${highest} of allele copies${population ? ` in the ${population} group` : '; the population group is not supplied'}.`,
    },
    sources: {
      ...(sources.dbsnp.length ? { dbSNP: sources.dbsnp } : {}),
      ...(sources.clinvarUrl ? { ClinVar: sources.clinvarUrl } : {}),
      ...(sources.gnomadUrl ? { gnomAD: sources.gnomadUrl } : {}),
      ...(sources.publications.length
        ? { PubMed: sources.publications.map((publication) => publication.url) }
        : {}),
    },
  };
}
