import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MatchCache, matchCacheIdentity } from '../src/lib/match-cache.js';
import { MATCH_CACHE } from '../src/config/match-cache.js';

export const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};
const config = {
  catalog: {
    phase: 'ready',
    sha256: 'public-catalog-hash',
    cacheKey: 'catalog-revision',
    rows: 100,
  },
  localGenome: { available: true, cacheKey: 'genome-revision' },
};
const identity = matchCacheIdentity(config);
const row = {
  citation: 'C1',
  rowNumber: 2,
  chrom: '1',
  pos: 10,
  ref: 'C',
  alt: 'T',
  sig: 'P',
  stars: 2,
  gene: 'SYNTHETIC',
  conditions: 'Synthetic_condition',
  call: { gt: '0/1', copies: 1, alleles: ['C', 'T'], filter: 'PASS' },
};
const entry = {
  source: { sha256: config.catalog.sha256, build: 'GRCh38' },
  total: 100,
  result: {
    build: 'GRCh38',
    matches: [row],
    issues: [],
    stats: { matched: 1, needsReview: 0, records: 1, notObserved: 99 },
    limitations: 'Synthetic exact matching.',
  },
};

test('complete matches survive a new cache instance, without session data or credentials', () => {
  const storage = memoryStorage();
  const cache = new MatchCache(() => storage);
  const written = cache.write(identity, {
    ...entry,
    config: { apiKey: 'SECRET', csrfToken: 'CSRF' },
    question: 'QUESTION',
    answer: 'ANSWER',
    documents: ['SEARCH_DOCUMENT'],
  });
  assert.equal(written.status, 'saved');
  const reloaded = new MatchCache(() => storage).read(identity);
  assert.deepEqual(reloaded.entry, entry);
  assert.equal(reloaded.info.count, 1);
  assert.equal(reloaded.info.savedAt, written.savedAt);
  for (const value of ['SECRET', 'CSRF', 'QUESTION', 'ANSWER', 'SEARCH_DOCUMENT'])
    assert.ok(!storage.getItem(MATCH_CACHE.key).includes(value));
  // Opening while the server is still checking files preserves, but never uses, the entry.
  assert.equal(cache.read(null).entry, null);
  assert.equal(cache.read(null).info.status, 'unchecked');
  assert.deepEqual(cache.read(identity).entry, entry);
});

test('catalog, genome and pipeline revisions invalidate saved evidence', () => {
  for (const changed of [
    { ...config, catalog: { ...config.catalog, sha256: 'new-content-hash' } },
    { ...config, catalog: { ...config.catalog, cacheKey: 'new-file-revision' } },
    { ...config, catalog: { ...config.catalog, rows: 101 } },
    { ...config, localGenome: { ...config.localGenome, cacheKey: 'new-genome-revision' } },
  ]) {
    const storage = memoryStorage();
    const cache = new MatchCache(() => storage);
    cache.write(identity, entry);
    const restored = cache.read(matchCacheIdentity(changed));
    assert.equal(restored.entry, null);
    assert.equal(restored.info.status, 'invalidated');
    assert.equal(storage.getItem(MATCH_CACHE.key), null);
  }
  for (const field of ['schema', 'pipeline']) {
    const storage = memoryStorage();
    const cache = new MatchCache(() => storage);
    cache.write(identity, entry);
    const saved = JSON.parse(storage.getItem(MATCH_CACHE.key));
    saved[field] = 'older';
    storage.setItem(MATCH_CACHE.key, JSON.stringify(saved));
    assert.equal(cache.read(identity).info.status, 'invalidated');
  }
  assert.equal(matchCacheIdentity({ ...config, localGenome: { available: false } }), null);
  assert.equal(
    matchCacheIdentity({ ...config, catalog: { ...config.catalog, cacheKey: null } }),
    null,
  );
});

test('malformed, edited or incomplete saved data is discarded instead of becoming evidence', () => {
  for (const corrupt of [
    () => '{invalid JSON',
    () => 'null',
    (raw) => raw.replace('SYNTHETIC', 'MODIFIED'),
    (raw) => {
      const saved = JSON.parse(raw);
      const data = JSON.parse(saved.data);
      data.result.stats.matched = 99;
      saved.data = JSON.stringify(data);
      saved.checksum = createHash('sha256').update(saved.data).digest('hex');
      return JSON.stringify(saved);
    },
  ]) {
    const storage = memoryStorage();
    const cache = new MatchCache(() => storage);
    cache.write(identity, entry);
    storage.setItem(MATCH_CACHE.key, corrupt(storage.getItem(MATCH_CACHE.key)));
    assert.equal(cache.read(identity).entry, null);
    assert.equal(storage.getItem(MATCH_CACHE.key), null);
  }
  const cache = new MatchCache(() => memoryStorage());
  assert.equal(
    cache.write(identity, {
      ...entry,
      result: { ...entry.result, stats: { matched: 2, needsReview: 0 } },
    }).status,
    'invalid',
  );
});

test('quota, denied storage and clearing affect only this cache and never throw', () => {
  const storage = memoryStorage();
  const cache = new MatchCache(() => storage);
  storage.setItem('other-app-data', 'keep');
  cache.write(identity, entry);
  assert.equal(cache.clear().status, 'empty');
  assert.equal(cache.read(identity).entry, null);
  assert.equal(storage.getItem('other-app-data'), 'keep');
  const unavailable = new MatchCache(() => {
    throw new Error('SecurityError');
  });
  assert.equal(unavailable.read(identity).info.status, 'unavailable');
  assert.equal(unavailable.write(identity, entry).status, 'unavailable');
  assert.equal(unavailable.clear().status, 'unavailable');
  const full = new MatchCache(() => ({
    ...storage,
    setItem() {
      throw new Error('QuotaExceededError');
    },
  }));
  assert.equal(full.write(identity, entry).status, 'unavailable');
  const large = {
    ...entry,
    result: { ...entry.result, limitations: 'x'.repeat(MATCH_CACHE.maxCharacters) },
  };
  assert.equal(cache.write(identity, large).status, 'unavailable');
  assert.equal(storage.getItem(MATCH_CACHE.key), null);
  assert.equal(new MatchCache(() => undefined).read(identity).info.status, 'unavailable');
});
