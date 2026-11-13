import { openConsumerFile } from '../vendor/genomewalk/consumer-dna/reader.ts';
import { observeCalls } from '../vendor/genomewalk/consumer-dna/engine/matching.ts';

export async function openConsumerGenome(file, signal) {
  const source = await openConsumerFile(file, signal);
  if (!['GRCh37', 'GRCh38'].includes(source.build)) {
    throw new Error(
      `The DNA export’s genome build is ${source.build}. Use an original GRCh37 or GRCh38 export with a declared build. No coordinate conversion is performed.`,
    );
  }
  if (source.strand !== 'forward')
    throw new Error(
      'The DNA export does not declare a consistent forward strand. Use an original forward-strand export; alleles are not flipped or guessed.',
    );
  return source;
}

// Adapt Genomewalk's carried-SNP observations to our existing evidence contract.
// Its parser and observation loop own all genotype, allele and duplicate rules.
export async function matchConsumerGenome({
  source,
  candidates,
  lookup,
  signal,
  onProgress = () => {},
}) {
  let records = 0,
    rsidLocationMismatches = 0;
  const counted = {
    ...source,
    readCalls: (each, progress, abort) =>
      source.readCalls(
        (call) => {
          records++;
          each(call);
        },
        progress,
        abort,
      ),
  };
  const catalogue = {
    async *rows() {
      for (const row of candidates) {
        signal?.throwIfAborted();
        yield [row.chrom, row.pos, row.ref, row.alt].join('\t');
      }
    },
  };
  const observed = await observeCalls(
    counted,
    catalogue,
    lookup,
    () => {
      rsidLocationMismatches++;
    },
    (fraction) => onProgress({ bytes: Math.round(fraction * source.size), records }),
    signal,
  );
  const byKey = new Map(
    candidates.map((row) => [[row.chrom, row.pos, row.ref, row.alt].join(':'), row]),
  );
  const matches = [],
    issues = [];
  for (const [key, observation] of observed) {
    const row = byKey.get(key);
    const { call, recordCount, conflictingRecords, sourceCalls } = observation;
    const matched = {
      ...row,
      build: source.build,
      recordCount,
      call: {
        gt: call.gt,
        alleles: call.alleles,
        copies: call.alleles.filter((a) => a === row.alt).length,
        ploidy: call.ploidy,
        format: 'consumer',
        provider: source.provider,
      },
    };
    if (conflictingRecords)
      issues.push({
        ...matched,
        reasons: ['Conflicting duplicate calls at this position'],
        observations: sourceCalls.map((fields) => ({ format: 'consumer', fields })),
      });
    else matches.push(matched);
  }
  return {
    build: source.build,
    matches,
    issues,
    stats: { records, matched: matches.length, needsReview: issues.length, rsidLocationMismatches },
    limitations:
      '23andMe and Ancestry matching uses complete two-letter A/C/G/T calls on chromosomes 1–22, in the file’s genome build and forward strand. Coordinates and carried alleles must agree with the catalog; known rsIDs also check the location. No-calls, partial calls, I/D encodings and sex/mitochondrial chromosomes are not matched. Conflicting duplicate sites are withheld. These exports do not supply VCF reference alleles or sequencing quality scores.',
  };
}
