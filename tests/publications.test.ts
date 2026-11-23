// Publication reader checks reused from Genomewalk; only import paths changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { PublicationCatalogue } from '../src/vendor/genomewalk/catalogues/publications.ts';
import {
  publicationShard,
  publicationManifest,
  publicationLabels,
} from '../src/vendor/genomewalk/catalogues/publication-format.ts';
import type {
  PublicationManifest,
  PublicationLabels,
} from '../src/vendor/genomewalk/catalogues/publication-format.ts';
import type { Fetcher } from '../src/vendor/genomewalk/io/types.ts';
import { AppError } from '../src/vendor/genomewalk/app-error.ts';

function fixture(labels: PublicationLabels) {
  const shards: Record<string, Uint8Array> = {};
  const manifest: PublicationManifest = {
    schema: 1,
    count: Object.keys(labels).length,
    labeled: Object.values(labels).filter(Boolean).length,
    shards: {},
  };
  for (let i = 0; i < 64; i++) {
    const key = i.toString(16).padStart(2, '0');
    const bytes = gzipSync(
      JSON.stringify(
        Object.fromEntries(Object.entries(labels).filter(([id]) => publicationShard(id) === key)),
      ),
    );
    const sha = createHash('sha256').update(bytes).digest('hex');
    manifest.shards[key] = sha;
    shards[`/ref/publications/${key}.${sha}.json.gz`] = bytes;
  }
  return { shards, manifest };
}

test('browser downloads only requested publication shards, sharing in-flight and completed requests', async () => {
  const { shards, manifest } = fixture({
    '1': 'One, Journal 2001',
    '65': 'Two, Journal 2002',
    '2': null,
  });
  const calls: string[] = [];
  const reader = new PublicationCatalogue(async (url, init) => {
    calls.push(String(url));
    if (String(url).endsWith('index.json')) {
      assert.equal(init?.cache, 'no-cache');
      return Response.json(manifest);
    }
    assert.ok(String(url).startsWith('/ref/publications/'));
    return new Response(shards[String(url)] as Uint8Array<ArrayBuffer>);
  });
  const [a, b] = await Promise.all([
    reader.load(['1', '65', '1', 'not-an-id']),
    reader.load(['1']),
  ]);
  assert.deepEqual(a, { '1': 'One, Journal 2001', '65': 'Two, Journal 2002' });
  assert.equal(b['1'], a['1']);
  assert.equal(calls.length, 2);
  await reader.load(['65']);
  assert.equal(calls.length, 2);
  assert.deepEqual(await reader.load(['2', '66']), { '2': null, '66': null });
  assert.equal(calls.length, 3);
  await reader.load([]);
  assert.equal(calls.length, 3);
});

test('invalid or unavailable public metadata falls back, and failed shards can be retried', async () => {
  const { shards, manifest } = fixture({ '1': 'One, Journal 2001' });
  let corrupt = true;
  const reader = new PublicationCatalogue(async (url) =>
    String(url).endsWith('index.json')
      ? Response.json(manifest)
      : new Response(corrupt ? gzipSync('{}') : (shards[String(url)] as Uint8Array<ArrayBuffer>)),
  );
  assert.deepEqual(await reader.load(['1']), { '1': null });
  corrupt = false;
  assert.deepEqual(await reader.load(['1']), { '1': 'One, Journal 2001' });
  assert.throws(() => publicationManifest({ ...manifest, shards: {} }), /Invalid/);
  assert.throws(() => publicationLabels({ '2': 'Wrong shard' }, '01'), /Invalid/);
  assert.throws(() => publicationLabels({ '1': { title: 'Wrong type' } }, '01'), /Invalid/);
});

test('concurrent result-page loads keep publication downloads bounded to four', async () => {
  const ids = Array.from({ length: 20 }, (_, i) => String(i + 1));
  const { shards, manifest } = fixture(
    Object.fromEntries(ids.map((id) => [id, `Author ${id}, Journal 2000`])),
  );
  let active = 0,
    peak = 0;
  const fetcher: Fetcher = async (url) => {
    if (String(url).endsWith('index.json')) return Response.json(manifest);
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return new Response(shards[String(url)] as Uint8Array<ArrayBuffer>);
  };
  const reader = new PublicationCatalogue(fetcher);
  await Promise.all([reader.load(ids.slice(0, 10)), reader.load(ids.slice(10))]);
  assert.equal(peak, 4);
});

test('publication failures report once per shared request and preserve fallback links', async () => {
  const { manifest } = fixture({ '1': 'Example, Journal 2000' });
  const errors: unknown[] = [];
  const reader = new PublicationCatalogue(
    async (url) =>
      String(url).endsWith('index.json')
        ? Response.json(manifest)
        : new Response('PRIVATE_RESPONSE_BODY', { status: 503 }),
    (error) => errors.push(error),
  );
  const results = await Promise.all([reader.load(['1']), reader.load(['1'])]);
  assert.deepEqual(results, [{ '1': null }, { '1': null }]);
  assert.equal(errors.length, 1);
  const error = errors[0];
  assert.ok(error instanceof AppError);
  assert.equal(error.code, 'HTTP_ERROR');
  assert.deepEqual(error.details, {
    resource: 'publication-labels',
    publicFile: '/ref/publications/[shard].json.gz',
    httpStatus: 503,
  });
  assert.ok(!JSON.stringify(error).includes('PRIVATE_RESPONSE_BODY'));

  const indexErrors: unknown[] = [];
  const unavailable = new PublicationCatalogue(
    async () => new Response(null, { status: 404 }),
    (error) => indexErrors.push(error),
  );
  const failed = await Promise.allSettled([unavailable.load(['1']), unavailable.load(['2'])]);
  assert.ok(failed.every((result) => result.status === 'rejected'));
  assert.equal(indexErrors.length, 1);
  assert.ok(indexErrors[0] instanceof AppError);
  assert.deepEqual(indexErrors[0].details, {
    resource: 'publication-index',
    publicFile: '/ref/publications/index.json',
    httpStatus: 404,
  });
});
