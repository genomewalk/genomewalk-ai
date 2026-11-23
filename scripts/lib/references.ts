import type { CatalogConfig } from '../../src/lib/types.ts';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { createGunzip, gunzipSync } from 'node:zlib';
import { fingerprint } from './files.ts';
import { loadCatalogue } from '../../src/vendor/genomewalk/catalogues/catalogue-stream.ts';
import { validateLookup } from '../../src/vendor/genomewalk/consumer-dna/lookup/index.ts';
import {
  publicationManifest,
  publicationLabels,
  validPmid,
} from '../../src/vendor/genomewalk/catalogues/publication-format.ts';

const BUILDS = ['GRCh37', 'GRCh38'];
export const REFERENCE_FILES = BUILDS.flatMap((build) => [
  `${build}/catalog.tsv.gz`,
  `${build}/catalog.meta.json`,
  `consumer-dna/${build}/rsids.json.gz`,
]);

export async function publicationFiles(directory: string) {
  const manifest = publicationManifest(
    JSON.parse(await readFile(join(directory, 'publications/index.json'), 'utf8')),
  );
  return [
    'publications/index.json',
    ...Object.entries(manifest.shards).map(([key, sha]) => `publications/${key}.${sha}.json.gz`),
  ];
}

async function inspectPublications(directory: string, expected: Set<string>) {
  const index = join(directory, 'publications/index.json');
  const manifest = publicationManifest(JSON.parse(await readFile(index, 'utf8')));
  let count = 0;
  let labeled = 0;
  for (const [key, sha] of Object.entries(manifest.shards)) {
    const path = join(directory, `publications/${key}.${sha}.json.gz`);
    if ((await fingerprint(path)).sha256 !== sha)
      throw new Error('Publication metadata does not match its manifest.');
    const labels = publicationLabels(JSON.parse(gunzipSync(await readFile(path)).toString()), key);
    for (const [id, label] of Object.entries(labels)) {
      if (!expected.delete(id)) throw new Error('Publication metadata differs from the catalogs.');
      count++;
      if (label) labeled++;
    }
  }
  if (expected.size || count !== manifest.count || labeled !== manifest.labeled)
    throw new Error('Publication metadata is incomplete. Run Genomewalk data:publications.');
  return { ...(await fingerprint(index)), count, labeled };
}

// Use the prepared Genomewalk artifacts without rebuilding or changing rows.
// The small release file gives browser caches content-based identities.
export async function inspectReferences(directory: string) {
  const catalogs: Record<string, Omit<CatalogConfig, 'phase'>> = {};
  const pmids = new Set<string>();
  for (const build of BUILDS) {
    const metaPath = join(directory, build, 'catalog.meta.json');
    const metadata = await readFile(metaPath);
    const catalog = await loadCatalogue(
      build,
      undefined,
      undefined,
      async () => new Response(metadata),
    );
    const actual = await fingerprint(join(directory, build, 'catalog.tsv.gz'));
    if (actual.size !== catalog.source.size || actual.sha256 !== catalog.source.sha256)
      throw new Error(`${build} catalog does not match its metadata.`);
    const lookupPath = join(directory, 'consumer-dna', build, 'rsids.json.gz');
    const lookup = JSON.parse(gunzipSync(await readFile(lookupPath)).toString('utf8'));
    await validateLookup(lookup, build, 'catalog', catalog.source);
    catalogs[build] = {
      build,
      rows: catalog.n,
      sha256: actual.sha256,
      cacheKey: (await fingerprint(metaPath)).sha256,
      lookupRevision: (await fingerprint(lookupPath)).sha256,
    };
    const lines = createInterface({
      input: createReadStream(join(directory, build, 'catalog.tsv.gz')).pipe(createGunzip()),
      crlfDelay: Infinity,
    });
    const column = catalog.header.slice(1).split('\t').indexOf('pmids');
    for await (const line of lines)
      if (!line.startsWith('#'))
        for (const id of (line.split('\t')[column] ?? '').split(','))
          if (validPmid(id)) pmids.add(id);
  }
  return { schema: 1, catalogs, publications: await inspectPublications(directory, pmids) };
}
