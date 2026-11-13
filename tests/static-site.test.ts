import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStaticServer } from '../scripts/lib/static-server.ts';
import { loadReferenceConfig, publicFile, referenceFetcher } from '../src/lib/public-files.ts';

test('static preview serves exact bytes, HEAD, ranges and subdirectories without API or upload handlers', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'genomewalk-static-'));
  await mkdir(join(directory, 'genomewalk-ai/samples'), { recursive: true });
  await writeFile(join(directory, 'genomewalk-ai/index.html'), '<h1>Static fixture</h1>');
  const bytes = Buffer.from([31, 139, 8, 0, 1, 2, 3, 4]);
  await writeFile(join(directory, 'genomewalk-ai/samples/test.vcf.gz'), bytes);
  await writeFile(join(directory, 'model.wasm'), Buffer.from([0, 97, 115, 109]));
  const server = createStaticServer(directory).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    server.close();
    await rm(directory, { recursive: true });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  assert.equal(await (await fetch(`${origin}/genomewalk-ai/`)).text(), '<h1>Static fixture</h1>');
  const url = `${origin}/genomewalk-ai/samples/test.vcf.gz`;
  const full = await fetch(url);
  assert.equal(full.headers.get('content-encoding'), 'identity');
  assert.equal(full.headers.get('content-type'), 'application/gzip');
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), String(bytes.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  for (const [range, start, end] of [
    ['bytes=2-4', 2, 5],
    ['bytes=-3', 5, 8],
    ['bytes=5-', 5, 8],
  ] as [string, number, number][]) {
    const response = await fetch(url, { headers: { Range: range } });
    assert.equal(response.status, 206);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(start, end));
  }
  assert.equal((await fetch(url, { headers: { Range: 'bytes=99-' } })).status, 416);
  assert.equal(
    (await fetch(`${origin}/model.wasm`)).headers.get('content-type'),
    'application/wasm',
  );
  for (const path of ['/api/status', '/api/example-genome', '/lininforet', '/.env.local']) {
    assert.equal((await fetch(origin + path)).status, 404);
  }
  assert.equal(
    (await fetch(url, { method: 'POST', body: 'private genome must not be accepted' })).status,
    405,
  );
});

test('public paths retain deployment prefixes and readers use only fixed reference resources', () => {
  assert.equal(
    publicFile('/ref/GRCh38/catalog.tsv.gz', '/genomewalk-ai/'),
    '/genomewalk-ai/ref/GRCh38/catalog.tsv.gz',
  );
  assert.equal(publicFile('/samples/example.vcf.gz', '/'), '/samples/example.vcf.gz');
  const signal = AbortSignal.abort();
  referenceFetcher(async (path, options) => {
    assert.equal(path, '/ref/GRCh38/catalog.meta.json');
    assert.equal(options!.signal, signal);
    return new Response();
  })('/ref/GRCh38/catalog.meta.json', { signal });
});

test('static release validates supported builds and uses content fingerprints for cache identity', async () => {
  const release: {
    schema: number;
    catalogs: Record<string, { rows: number; lookupRevision: string }>;
  } = JSON.parse(await readFile(new URL('../public/ref/release.json', import.meta.url), 'utf8'));
  for (const build of ['GRCh37', 'GRCh38']) {
    const result = await loadReferenceConfig(build, {
      fetchImpl: async (url, options) => {
        assert.equal(url, '/ref/release.json');
        assert.equal(options!.cache, 'no-cache');
        return Response.json(release);
      },
    });
    assert.equal(result.phase, 'ready');
    assert.deepEqual(
      { ...result, phase: undefined },
      { ...release.catalogs[build], phase: undefined },
    );
  }
  await assert.rejects(
    loadReferenceConfig('GRCh36', {
      fetchImpl: () => {
        throw new Error('Must not fetch');
      },
    }),
    /supported/,
  );
  for (const change of [
    (r: typeof release) => {
      r.schema = 2;
    },
    (r: typeof release) => {
      r.catalogs.GRCh38!.rows = 0;
    },
    (r: typeof release) => {
      r.catalogs.GRCh38!.lookupRevision = 'invalid';
    },
  ]) {
    const invalid = structuredClone(release);
    change(invalid);
    await assert.rejects(
      loadReferenceConfig('GRCh38', { fetchImpl: async () => Response.json(invalid) }),
      /invalid/,
    );
  }
  await assert.rejects(
    loadReferenceConfig('GRCh38', {
      fetchImpl: async () => new Response('missing', { status: 404 }),
    }),
    /could not be loaded/,
  );
});
