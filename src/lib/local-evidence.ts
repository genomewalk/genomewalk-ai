import type { CatalogRow, MatchedRow, SourceLink } from './types.ts';

// The prepared catalog supplies symbols, not numeric NCBI Gene IDs.
export function geneSource(gene: string): SourceLink {
  return {
    label: gene,
    url: `https://www.ncbi.nlm.nih.gov/gene/?term=${encodeURIComponent(`${gene}[sym] AND human[orgn]`)}`,
  };
}

const text = (value: unknown) =>
  value == null || value === '' || value === '.' ? null : String(value);
const number = (value: unknown) =>
  text(value) !== null && Number.isFinite(Number(value)) ? Number(value) : null;
const list = (value: unknown, separator = '|') =>
  text(value)
    ?.split(separator)
    .map((item) => item.trim())
    .filter(Boolean) ?? [];
const positiveId = (value: unknown) => typeof value === 'string' && /^[1-9]\d*$/.test(value);
export function refSnpIds(value: CatalogRow['rsids']) {
  return [
    ...new Set(
      list(value).flatMap((id) => {
        const match = /^(?:rs)?([1-9]\d*)$/i.exec(id);
        return match ? [`rs${match[1]}`] : [];
      }),
    ),
  ];
}
export function alleleFraction(value: CatalogRow['af']) {
  const fraction = number(typeof value === 'string' ? value.trim() : value);
  return fraction !== null && fraction >= 0 && fraction <= 1 ? fraction : null;
}
// Genomewalk supplies gnomAD v4 keys in both build catalogs. Always use that
// normalized GRCh38 key, never the uploaded file’s coordinate or build.
const gnomadKeyPattern = /^(?:[1-9]|1\d|2[0-2]|X|Y)-[1-9]\d*-[ACGT]+-[ACGT]+$/;

// The facts an answer record is built from. Observations and reference annotations
// stay separate; missing values are null, never a fabricated zero or clinical claim.
export function matchForLocalModel(row: MatchedRow, build: string) {
  const call = row.call;
  const alleles = Array.isArray(call.alleles) ? [...call.alleles] : null;
  const zygosity =
    alleles?.length === 1
      ? 'haploid_call'
      : alleles?.length === 2
        ? alleles[0] === alleles[1]
          ? 'homozygous'
          : 'heterozygous'
        : 'unknown';
  const variationId = text(row.variationid);
  const gnomadKey = text(row.gnomadkey);
  return {
    variant: {
      build,
      chromosome: row.chrom,
      position: row.pos,
      referenceAllele: row.ref,
      matchedAllele: row.alt,
      gene: text(row.gene),
    },
    genotype: {
      alleles,
      matchedAlleleCopies: call.copies,
      zygosity: zygosity as 'haploid_call' | 'homozygous' | 'heterozygous' | 'unknown',
    },
    clinvar: {
      classification: text(row.classification),
      conflictingClassifications: text(row.conflictingclassifications),
      conditions: text(row.conditions),
      reviewStars: number(row.stars),
      reviewStatus: text(row.reviewstatus),
    },
    populationFrequency: { maximumPopulation: text(row.grp) },
    sources: {
      clinvarUrl: positiveId(variationId)
        ? `https://www.ncbi.nlm.nih.gov/clinvar/variation/${variationId}/`
        : null,
      dbsnp: refSnpIds(row.rsids).map((id) => ({
        label: id,
        url: `https://www.ncbi.nlm.nih.gov/snp/${id}`,
      })),
      gnomadUrl:
        ['GRCh37', 'GRCh38'].includes(build) && gnomadKeyPattern.test(gnomadKey ?? '')
          ? `https://gnomad.broadinstitute.org/variant/${encodeURIComponent(gnomadKey!)}?dataset=gnomad_r4`
          : null,
      publications: list(row.pmids, ',')
        .filter(positiveId)
        .map((pmid) => ({ pmid, url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` })),
    },
  };
}
