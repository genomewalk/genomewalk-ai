import test from 'node:test';
import assert from 'node:assert/strict';
import { matchForLocalModel } from '../src/lib/local-evidence.js';

const row = {
  citation: 'C1',
  chrom: '1',
  pos: 10,
  ref: 'C',
  alt: 'T',
  gene: 'TEST',
  variationid: '123',
  alleleid: '456',
  classification: 'Pathogenic',
  sig: 'P',
  stars: 2,
  reviewstatus: 'criteria_provided,_multiple_submitters,_no_conflicts',
  conditions: 'Autosomal_dominant_example|Autosomal_recessive_example',
  af: '0.00008',
  afmax: '0.0002',
  grp: 'sas',
  an: '100000',
  gnomadac: '8',
  gnomadfilter: 'PASS',
  gnomadkey: '1-10-C-T',
  gnomaddiscordancep: '.',
  pmids: '12345,67890',
  rsids: 'rs12345',
  hgvs: 'TEST:c.1C>T',
  releasedate: '2026-09-05',
  call: {
    gt: '0/1',
    alleles: ['C', 'T'],
    copies: 1,
    ploidy: 2,
    filter: 'PASS',
    dp: 31,
    gq: 127,
    qual: 222.14,
    alleleDepths: { alleles: ['C', 'T'], readCounts: [19, 12] },
  },
};

test('local JSON separates observed genotype from complete catalog annotations and preserves frequency units', () => {
  const evidence = matchForLocalModel(row, 'GRCh38');
  assert.deepEqual(evidence.genotype.alleles, ['C', 'T']);
  assert.equal(evidence.genotype.zygosity, 'heterozygous');
  assert.equal(evidence.genotype.matchedAlleleCopies, 1);
  assert.equal(evidence.genotype.quality.variantQuality, 222.14);
  assert.equal(evidence.clinvar.reviewStatus, row.reviewstatus);
  assert.equal(evidence.clinvar.conditions, row.conditions);
  assert.equal(evidence.populationFrequency.overallAlleleFrequency, 0.00008);
  assert.equal(evidence.populationFrequency.maximumPopulationAlleleFrequency, 0.0002);
  assert.equal(evidence.populationFrequency.maximumPopulation, 'sas');
  assert.equal(evidence.populationFrequency.units, 'allele_fraction_not_percent_or_personal_risk');
  assert.equal(evidence.populationFrequency.discordanceP, null);
  assert.deepEqual(evidence.sources.pubmedIds, ['12345', '67890']);
  assert.equal(evidence.sources.publicationContentProvided, false);
});

test('source URLs use catalog identifiers, including the normalized gnomAD key', () => {
  const evidence = matchForLocalModel({ ...row, gnomadkey: '1-9-AC-A' }, 'GRCh38');
  assert.equal(evidence.sources.clinvarUrl, 'https://www.ncbi.nlm.nih.gov/clinvar/variation/123/');
  assert.equal(
    evidence.sources.gnomadUrl,
    'https://gnomad.broadinstitute.org/variant/1-9-AC-A?dataset=gnomad_r4',
  );
  assert.equal(evidence.populationFrequency.variantKey, '1-9-AC-A');
  assert.equal(
    evidence.variant.position,
    10,
    'A source link must not change the observed coordinates',
  );
  assert.deepEqual(evidence.sources.publications, [
    { pmid: '12345', url: 'https://pubmed.ncbi.nlm.nih.gov/12345/' },
    { pmid: '67890', url: 'https://pubmed.ncbi.nlm.nih.gov/67890/' },
  ]);
  assert.equal(evidence.sources.publicationContentProvided, false);
});

test('missing or malformed source identifiers do not become guessed or injected links', () => {
  for (const value of [
    null,
    undefined,
    '.',
    '',
    '0',
    '-1',
    '123/?private=value',
    'https://example.com',
  ]) {
    const evidence = matchForLocalModel(
      { ...row, variationid: value, pmids: value, gnomadkey: value },
      'GRCh38',
    );
    assert.equal(evidence.sources.clinvarUrl, null);
    assert.equal(evidence.sources.gnomadUrl, null);
    assert.deepEqual(evidence.sources.pubmedIds, []);
    assert.deepEqual(evidence.sources.publications, []);
  }
  const mixed = matchForLocalModel(
    { ...row, pmids: '12345,0, -1, 67890,https://example.com' },
    'GRCh38',
  );
  assert.deepEqual(mixed.sources.pubmedIds, ['12345', '67890']);
  for (const key of [
    '1-0-C-T',
    '23-10-C-T',
    'MT-10-C-T',
    '1-10-C-<DEL>',
    '1-10-C-T?private=value',
  ]) {
    const evidence = matchForLocalModel({ ...row, gnomadkey: key }, 'GRCh38');
    assert.equal(evidence.sources.gnomadUrl, null);
    assert.equal(
      evidence.populationFrequency.variantKey,
      key,
      'Unsupported keys remain inspectable',
    );
  }
  assert.equal(matchForLocalModel(row, 'unsupported').sources.gnomadUrl, null);
  assert.equal(matchForLocalModel({ ...row, gnomadkey: null }, 'GRCh38').sources.gnomadUrl, null);
});

test('missing reference values stay unknown; zero is preserved and genotype labels follow observed alleles', () => {
  const missing = matchForLocalModel(
    {
      ...row,
      af: '.',
      afmax: '',
      an: undefined,
      gnomadac: '0',
      stars: 0,
      call: { ...row.call, gt: '1/2', alleles: ['A', 'T'] },
    },
    'GRCh38',
  );
  assert.equal(missing.populationFrequency.overallAlleleFrequency, null);
  assert.equal(missing.populationFrequency.maximumPopulationAlleleFrequency, null);
  assert.equal(missing.populationFrequency.overallAlleleNumber, null);
  assert.equal(missing.populationFrequency.overallAlleleCount, 0);
  assert.equal(missing.clinvar.reviewStars, 0);
  assert.deepEqual(missing.genotype.alleles, ['A', 'T']);
  assert.equal(missing.genotype.zygosity, 'heterozygous');
  assert.equal(
    matchForLocalModel({ ...row, call: { ...row.call, alleles: ['T', 'T'] } }, 'GRCh38').genotype
      .zygosity,
    'homozygous',
  );
  assert.equal(
    matchForLocalModel({ ...row, call: { ...row.call, alleles: ['T'] } }, 'GRCh38').genotype
      .zygosity,
    'haploid_call',
  );
});
