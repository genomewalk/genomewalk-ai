import type {
  CatalogRow,
  GenomeCall,
  MatchedRow,
  ExcludedRow,
  MatchResult,
  ProgressOptions,
} from './types.ts';

interface Observation {
  row: CatalogRow;
  signature: string | null;
  call: GenomeCall;
  observations: GenomeCall[];
  recordCount: number;
  reasons: Set<string>;
}
interface ScanOptions extends ProgressOptions {
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
  candidates?: CatalogRow[];
  headerOnly?: boolean;
}
import { Inflate } from 'pako';
import { detectBuild } from '../vendor/genomewalk/vcf/reference.ts';

const normalizeChrom = (value: string | undefined) =>
  String(value).replace(/^chr/i, '').toUpperCase().replace(/^M$/, 'MT');
const siteKey = (chrom: string, pos: number) => `${normalizeChrom(chrom)}:${pos}`;
const callNumber = (value: string | undefined) =>
  value && value !== '.' && Number.isFinite(Number(value)) && Number(value) >= 0
    ? Number(value)
    : null;

class VcfMatcher {
  sites: Map<string, CatalogRow[]>;
  observed: Map<string, Observation>;
  header: boolean;
  format: boolean;
  metadata: string[];
  lineNumber: number;
  stats: Required<Omit<MatchResult['stats'], 'rsidLocationMismatches'>>;
  constructor(candidates: CatalogRow[]) {
    this.sites = new Map();
    for (const row of candidates) {
      const key = siteKey(row.chrom, row.pos);
      if (!this.sites.has(key)) this.sites.set(key, []);
      this.sites.get(key)!.push(row);
    }
    this.observed = new Map();
    this.header = false;
    this.format = false;
    this.metadata = [];
    this.lineNumber = 0;
    this.stats = {
      records: 0,
      candidateRecords: 0,
      matched: 0,
      needsReview: 0,
      explicitlyNotCarried: 0,
      notObserved: candidates.length,
    };
  }
  line(line: string) {
    this.lineNumber++;
    if (!line) return;
    if (this.lineNumber === 1) {
      if (!/^##fileformat=VCFv4\.[1-5]$/.test(line))
        throw new Error('Use a VCF version 4.1–4.5 file.');
      this.format = true;
    }
    if (line.startsWith('##')) {
      if (this.header) throw new Error('Unexpected metadata after the VCF header.');
      this.metadata.push(line);
      return;
    }
    if (line.startsWith('#CHROM')) {
      const columns = line.split('\t');
      if (
        this.header ||
        columns.length !== 10 ||
        columns.slice(0, 9).join('\t') !== '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT'
      )
        throw new Error('Use a single-sample VCF with the standard FORMAT and sample columns.');
      if (!this.format || detectBuild(this.metadata) !== 'GRCh38')
        throw new Error(
          'The VCF header must identify GRCh38/hg38 through its reference declaration or chromosome lengths, without a conflicting build. No genome build conversion is performed.',
        );
      this.header = true;
      return;
    }
    if (!this.header || line.startsWith('#'))
      throw new Error('The VCF header is missing or malformed.');
    const fields = line.split('\t');
    if (
      fields.length !== 10 ||
      !/^\d+$/.test(fields[1] ?? '') ||
      Number(fields[1]) < 1 ||
      !Number.isSafeInteger(Number(fields[1]))
    )
      throw new Error(
        `Malformed VCF record at line ${this.lineNumber}. No partial result was used.`,
      );
    // The validated VCF record has exactly the ten standard sample columns.
    const [chrom, , id, reference, alternate, quality, filter, , formatText, sampleValues] =
      fields as [string, string, string, string, string, string, string, string, string, string];
    this.stats.records++;
    const candidates = this.sites.get(siteKey(chrom, Number(fields[1])));
    if (!candidates) return;
    const ref = reference.toUpperCase();
    const alts = alternate.toUpperCase().split(',');
    const format = formatText.split(':');
    const values = sampleValues.split(':');
    const get = (name: string) => values[format.indexOf(name)];
    const gt = get('GT') ?? '.';
    const indices = gt.split(/[/|]/);
    const options = [ref, ...alts];
    const complete =
      indices.length >= 1 &&
      indices.length <= 2 &&
      indices.every((index) => /^\d+$/.test(index) && Number(index) < options.length);
    const alleles = complete ? indices.map((index) => options[Number(index)]!) : [];
    const supported = complete && alleles.every((allele) => /^[ACGT]+$/.test(allele));
    const sampleFilter = get('FT');
    // Genomewalk accepts PASS or '.' (filters not applied), never a failed filter.
    const acceptedFilter =
      (fields[6] === 'PASS' || fields[6] === '.') &&
      (!sampleFilter || sampleFilter === '.' || sampleFilter === 'PASS');
    const depths = get('AD')?.split(',');
    const alleleDepths =
      depths?.length === options.length &&
      depths.every((depth) => depth === '.' || /^\d+$/.test(depth))
        ? { alleles: options, readCounts: depths.map(callNumber) }
        : null;
    for (const row of candidates) {
      const altIndex = alts.indexOf(row.alt);
      if (ref !== row.ref || altIndex < 0) continue;
      this.stats.candidateRecords++;
      const copies = supported
        ? indices.filter((index) => Number(index) === altIndex + 1).length
        : null;
      const signature = supported ? [...alleles].sort().join('/') : null;
      const observation = {
        line: this.lineNumber,
        gt,
        copies,
        ploidy: indices.length,
        alleles,
        filter,
        sampleFilter: sampleFilter ?? null,
        dp: callNumber(get('DP')),
        gq: callNumber(get('GQ')),
        qual: callNumber(fields[5]),
        alleleDepths,
        // Preserve this matched call for local inspection; no sample identifier,
        // path, header, or unrelated INFO annotations enter the model context.
        sourceVcfFields: {
          chrom,
          pos: Number(fields[1]),
          id,
          ref: reference,
          alt: alternate,
          qual: quality,
          filter,
          format: formatText,
          sampleValues,
        },
      };
      const previous = this.observed.get(row.citation);
      const reasons = [];
      if (!supported) reasons.push('Missing, partial, unsupported, or invalid genotype');
      if (!acceptedFilter) reasons.push('Record or sample filter did not pass');
      if (previous && previous.signature !== signature)
        reasons.push('Duplicate records disagree about the genotype');
      if (previous) {
        for (const reason of reasons) previous.reasons.add(reason);
        if (previous.observations.length < 3) previous.observations.push(observation);
        previous.recordCount++;
      } else
        this.observed.set(row.citation, {
          row,
          signature,
          call: observation,
          observations: [observation],
          recordCount: 1,
          reasons: new Set(reasons),
        });
    }
  }
  finish(): MatchResult {
    if (!this.header) throw new Error('No complete single-sample GRCh38 VCF header was found.');
    const matches: MatchedRow[] = [];
    const issues: ExcludedRow[] = [];
    for (const item of this.observed.values()) {
      if (item.reasons.size)
        issues.push({
          ...item.row,
          reasons: [...item.reasons],
          observations: item.observations,
          recordCount: item.recordCount,
        });
      else if ((item.call.copies ?? 0) > 0)
        matches.push({ ...item.row, call: item.call, recordCount: item.recordCount });
      else this.stats.explicitlyNotCarried++;
    }
    // Review order only; this is not a risk or severity ranking.
    const order = (a: CatalogRow, b: CatalogRow) =>
      Number(b.stars) - Number(a.stars) || Number(a.rowNumber) - Number(b.rowNumber);
    matches.sort(order);
    issues.sort(order);
    return {
      build: 'GRCh38',
      matches,
      issues,
      stats: {
        ...this.stats,
        matched: matches.length,
        needsReview: issues.length,
        notObserved: this.stats.notObserved - this.observed.size,
      },
      limitations:
        'Exact chromosome/position/REF/ALT matching only; equivalent indel representations, structural variants, and unselected catalog records may be missed. No liftover, normalization, callability assessment, inheritance analysis, or clinical risk scoring. Absence of a matching row is not evidence of absence or benignity. PASS is a file annotation, not clinical confirmation.',
    };
  }
}

// Shared by the browser worker and synthetic tests. No network, storage, or logging.
export function scanVcf(
  options: ScanOptions & { headerOnly: true },
): Promise<{ build: string; samples: number }>;
export function scanVcf(options: ScanOptions & { headerOnly?: false }): Promise<MatchResult>;
export async function scanVcf({
  chunks,
  candidates = [],
  headerOnly = false,
  signal,
  onProgress = () => {},
}: ScanOptions) {
  const matcher = new VcfMatcher(candidates);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let carry = '';
  let compressed: boolean | undefined;
  let inflate: Inflate | undefined;
  let inflateStream: Parameters<Inflate['onStart']>[0] | undefined;
  let bytes = 0;
  let decodedBytes = 0;
  let prefix = new Uint8Array();
  const headerFound = {};
  const consume = (data: Uint8Array) => {
    decodedBytes += data.byteLength;
    if (decodedBytes > 30 * 1024 ** 3)
      throw new Error('Decoded VCF exceeds the 30 GB safety limit.');
    carry += decoder.decode(data, { stream: true });
    let end;
    while ((end = carry.indexOf('\n')) >= 0) {
      const line = carry.slice(0, end).replace(/\r$/, '');
      carry = carry.slice(end + 1);
      if (line.length > 1048576) throw new Error('A VCF line exceeds the supported size.');
      matcher.line(line);
      if (headerOnly && matcher.header) throw headerFound;
    }
    if (carry.length > 1048576 || (!matcher.header && decodedBytes > 8 * 1024 ** 2))
      throw new Error('The VCF header or line exceeds the supported size.');
  };
  const push = (data: Uint8Array) => {
    if (!compressed) {
      consume(data);
      return;
    }
    // Pako finishes a member when it ends exactly at an input chunk boundary.
    // Start a fresh gzip decoder for the next member (including BGZF blocks).
    if (!inflate || inflate.ended) {
      inflate = new Inflate({ windowBits: 31, chunkSize: 65536 });
      inflate.onData = consume;
      inflate.onStart = (stream) => {
        inflateStream = stream;
      };
    }
    if (!inflate.push(data) || inflate.err)
      throw new Error('The gzip data is corrupt or incomplete. No partial result was used.');
    if (
      inflate.ended &&
      (inflateStream?.avail_in ?? 0) &&
      data.slice(data.length - (inflateStream?.avail_in ?? 0)).some((byte) => byte !== 0)
    )
      throw new Error('Unexpected data after the gzip stream.');
  };
  try {
    for await (const chunk of chunks) {
      signal?.throwIfAborted();
      bytes += chunk.byteLength;
      if (compressed === undefined) {
        const joined = new Uint8Array(prefix.length + chunk.length);
        joined.set(prefix);
        joined.set(chunk, prefix.length);
        prefix = joined;
        if (prefix.length < 2) continue;
        compressed = prefix[0] === 31 && prefix[1] === 139;
        push(prefix);
        prefix = new Uint8Array();
      } else push(chunk);
      onProgress({ bytes, records: matcher.stats.records });
    }
    signal?.throwIfAborted();
    if (
      compressed &&
      inflate &&
      !inflate.ended &&
      (!inflate.push(new Uint8Array(), true) || inflate.err)
    )
      throw new Error('The gzip stream is truncated. No partial result was used.');
    carry += decoder.decode();
    if (carry) matcher.line(carry.replace(/\r$/, ''));
    if (headerOnly) {
      matcher.finish();
      return { build: 'GRCh38', samples: 1 };
    }
    return matcher.finish();
  } catch (error) {
    if (error === headerFound) return { build: 'GRCh38', samples: 1 };
    throw error;
  }
}
