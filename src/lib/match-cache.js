import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { MATCH_CACHE } from '../config/match-cache.js';

const digest = (value) => bytesToHex(sha256(new TextEncoder().encode(value)));
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const info = (status, message, extra = {}) => ({ status, message, hasSaved: false, ...extra });

export function matchCacheIdentity(config) {
  if (
    config.catalog?.phase !== 'ready' ||
    !config.localGenome?.available ||
    !config.catalog.sha256 ||
    !config.catalog.cacheKey ||
    !config.localGenome.cacheKey
  )
    return null;
  return digest(
    JSON.stringify([
      MATCH_CACHE.pipelineVersion,
      config.localGenome.build ?? 'GRCh38',
      config.localGenome.format ?? 'vcf',
      config.localGenome.format === 'consumer' ? config.catalog.lookupRevision : null,
      config.catalog.sha256,
      config.catalog.cacheKey,
      config.catalog.rows,
      config.localGenome.cacheKey,
    ]),
  );
}

function validEntry(entry) {
  if (
    !object(entry) ||
    !['GRCh37', 'GRCh38'].includes(entry.source?.build) ||
    typeof entry.source.sha256 !== 'string' ||
    !integer(entry.total)
  )
    return false;
  const result = entry.result;
  if (
    !object(result) ||
    result.build !== entry.source.build ||
    !Array.isArray(result.matches) ||
    !Array.isArray(result.issues) ||
    !object(result.stats) ||
    typeof result.limitations !== 'string'
  )
    return false;
  if (
    result.stats.matched !== result.matches.length ||
    result.stats.needsReview !== result.issues.length ||
    !Object.values(result.stats).every(integer) ||
    result.matches.length + result.issues.length > entry.total
  )
    return false;
  const seen = new Set();
  for (const row of [...result.matches, ...result.issues]) {
    if (
      !object(row) ||
      typeof row.citation !== 'string' ||
      seen.has(row.citation) ||
      !integer(row.rowNumber) ||
      row.rowNumber < 2 ||
      typeof row.chrom !== 'string' ||
      !integer(row.pos) ||
      row.pos < 1 ||
      typeof row.ref !== 'string' ||
      typeof row.alt !== 'string' ||
      typeof row.sig !== 'string'
    )
      return false;
    seen.add(row.citation);
  }
  return (
    result.matches.every(
      (row) =>
        object(row.call) &&
        typeof row.call.gt === 'string' &&
        Array.isArray(row.call.alleles) &&
        row.call.alleles.every((allele) => typeof allele === 'string') &&
        integer(row.call.copies) &&
        row.call.copies > 0,
    ) && result.issues.every((row) => Array.isArray(row.reasons) && Array.isArray(row.observations))
  );
}

// One replaceable entry on this origin. No full genome file, configuration/credentials,
// question, answer or embedding vectors. Storage failures never stop inference.
export class MatchCache {
  constructor(
    getStorage = () => (typeof window === 'undefined' ? undefined : window.localStorage),
  ) {
    this.getStorage = getStorage;
  }
  read(identity) {
    try {
      const storage = this.getStorage();
      if (!storage)
        return {
          entry: null,
          info: info('unavailable', 'Browser storage is unavailable; matches will stay in memory.'),
        };
      const raw = storage.getItem(MATCH_CACHE.key);
      if (raw === null)
        return {
          entry: null,
          info: info('empty', 'Matches will be saved in this browser after a complete scan.'),
        };
      if (!identity)
        return {
          entry: null,
          info: info('unchecked', 'Saved matches are waiting for the local file check.', {
            hasSaved: true,
          }),
        };
      const discard = (status, message) => {
        storage.removeItem(MATCH_CACHE.key);
        return { entry: null, info: info(status, message) };
      };
      let saved;
      let entry;
      try {
        if (raw.length > MATCH_CACHE.maxCharacters) throw new Error('Oversized cache');
        saved = JSON.parse(raw);
        if (
          saved.schema !== MATCH_CACHE.schemaVersion ||
          saved.pipeline !== MATCH_CACHE.pipelineVersion ||
          saved.identity !== identity
        )
          return discard(
            'invalidated',
            'Saved matches were cleared because the files or matching version changed.',
          );
        if (
          !integer(saved.savedAt) ||
          typeof saved.data !== 'string' ||
          saved.checksum !== digest(saved.data)
        )
          throw new Error('Invalid cache');
        entry = JSON.parse(saved.data);
        if (!validEntry(entry)) throw new Error('Invalid matching data');
      } catch {
        return discard(
          'invalid',
          'Unreadable saved matches were cleared; a fresh scan will be used.',
        );
      }
      return {
        entry,
        info: info(
          'saved',
          `${entry.result.matches.length.toLocaleString()} matches saved in this browser. The next preparation can reuse them.`,
          { hasSaved: true, count: entry.result.matches.length, savedAt: saved.savedAt },
        ),
      };
    } catch {
      return {
        entry: null,
        info: info('unavailable', 'Browser storage is unavailable; matches will stay in memory.', {
          hasSaved: true,
        }),
      };
    }
  }
  write(identity, { source, total, result }) {
    if (!identity)
      return info(
        'unavailable',
        'Matches were not saved because the local file revision could not be checked.',
      );
    try {
      const storage = this.getStorage();
      if (!storage) throw new Error('Storage unavailable');
      // Persist only completed matching output, never session or request state.
      const entry = {
        source: { build: source.build, sha256: source.sha256 },
        total,
        result: {
          build: result.build,
          matches: result.matches,
          issues: result.issues,
          stats: result.stats,
          limitations: result.limitations,
        },
      };
      if (!validEntry(entry))
        return info('invalid', 'Matches could not be saved; the current search will use memory.');
      const data = JSON.stringify(entry);
      const savedAt = Date.now();
      const raw = JSON.stringify({
        schema: MATCH_CACHE.schemaVersion,
        pipeline: MATCH_CACHE.pipelineVersion,
        identity,
        savedAt,
        checksum: digest(data),
        data,
      });
      if (raw.length > MATCH_CACHE.maxCharacters)
        return info(
          'unavailable',
          'Matches exceed the localStorage cache limit; the current search will use memory.',
        );
      storage.setItem(MATCH_CACHE.key, raw);
      return info(
        'saved',
        `${result.matches.length.toLocaleString()} matches saved in this browser for the next preparation.`,
        { hasSaved: true, count: result.matches.length, savedAt },
      );
    } catch {
      return info(
        'unavailable',
        'Could not save matches (browser storage is blocked or full). The current search will use memory.',
        { hasSaved: true },
      );
    }
  }
  clear() {
    try {
      this.getStorage()?.removeItem(MATCH_CACHE.key);
      return info(
        'empty',
        'Saved matches cleared. The next preparation will scan the local files again.',
      );
    } catch {
      return info(
        'unavailable',
        'Could not clear saved matches. Clear this site’s data in browser settings.',
        { hasSaved: true },
      );
    }
  }
}
