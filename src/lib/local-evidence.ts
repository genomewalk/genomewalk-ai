import type { MatchedRow } from './types.ts';
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
// Genomewalk supplies gnomAD v4 keys in both build catalogs. Always use that
// normalized GRCh38 key, never the uploaded file’s coordinate or build.
const gnomadKeyPattern = /^(?:[1-9]|1\d|2[0-2]|X|Y)-[1-9]\d*-[ACGT]+-[ACGT]+$/;

// Explicit local-only schema: observations and reference annotations stay
// separate. Missing values are null, never a fabricated zero or clinical claim.
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
  const pmids = list(row.pmids, ',').filter(positiveId);
  // ClinVar's RS field is pipe-separated. Keep only complete RefSNP IDs;
  // adding the standard rs prefix is formatting, not an identifier lookup.
  const rsIds = [
    ...new Set(
      list(row.rsids)
        .map((id) => /^(?:rs)?([1-9]\d*)$/i.exec(id)?.[1])
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const gnomadKey = text(row.gnomadkey);
  const match = {
    citation: row.citation,
    variant: {
      build,
      chromosome: row.chrom,
      position: row.pos,
      referenceAllele: row.ref,
      matchedAllele: row.alt,
      gene: text(row.gene),
      rsIds: text(row.rsids),
      hgvs: text(row.hgvs),
    },
    genotype: {
      gt: call.gt,
      alleles,
      matchedAlleleCopies: call.copies,
      ploidy: call.ploidy ?? null,
      zygosity: zygosity as 'haploid_call' | 'homozygous' | 'heterozygous' | 'unknown',
      phased: typeof call.gt === 'string' ? call.gt.includes('|') : null,
      quality: {
        recordFilter: text(call.filter),
        sampleFilter: text(call.sampleFilter),
        depth: call.dp ?? null,
        genotypeQuality: call.gq ?? null,
        variantQuality: call.qual ?? null,
        alleleDepths: call.alleleDepths ?? null,
      },
      vcfLineNumber: call.line ?? null,
      duplicateRecordCount: row.recordCount ?? 1,
      sourceVcfFields: call.sourceVcfFields ?? null,
    },
    clinvar: {
      variationId,
      alleleId: text(row.alleleid),
      classification: text(row.classification),
      classificationCode: text(row.sig),
      conflictingClassifications: text(row.conflictingclassifications),
      conditions: text(row.conditions),
      conditionMedgenIds: text(row.conditionmedgenids),
      reviewStars: number(row.stars),
      reviewStatus: text(row.reviewstatus),
    },
    populationFrequency: {
      source: 'gnomAD',
      units: 'allele_fraction_not_percent_or_personal_risk',
      overallAlleleFrequency: number(row.af),
      overallAlleleCount: number(row.gnomadac),
      overallAlleleNumber: number(row.an),
      maximumPopulationAlleleFrequency: number(row.afmax),
      maximumPopulation: text(row.grp),
      variantKey: gnomadKey,
      filter: text(row.gnomadfilter),
      discordanceP: number(row.gnomaddiscordancep),
    },
    sources: {
      clinvarUrl: positiveId(variationId)
        ? `https://www.ncbi.nlm.nih.gov/clinvar/variation/${variationId}/`
        : null,
      dbsnp: rsIds.map((id) => ({
        label: `rs${id}`,
        url: `https://www.ncbi.nlm.nih.gov/snp/rs${id}`,
      })),
      gnomadUrl:
        ['GRCh37', 'GRCh38'].includes(build) && gnomadKeyPattern.test(gnomadKey ?? '')
          ? `https://gnomad.broadinstitute.org/variant/${encodeURIComponent(gnomadKey!)}?dataset=gnomad_r4`
          : null,
      pubmedIds: pmids,
      publications: pmids.map((pmid) => ({
        pmid,
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      })),
      publicationContentProvided: false,
      catalogReleaseDate: text(row.releasedate),
      citationDate: text(row.citationdate),
    },
  };
  return match;
}
