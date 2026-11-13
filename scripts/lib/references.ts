import type { CatalogConfig } from '../../src/lib/types.ts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fingerprint } from './files.ts';
import { loadCatalogue } from '../../src/vendor/genomewalk/catalogues/catalogue-stream.ts';
import { validateLookup } from '../../src/vendor/genomewalk/consumer-dna/lookup/index.ts';

const BUILDS = ['GRCh37', 'GRCh38'];
export const REFERENCE_FILES = BUILDS.flatMap((build) => [
  `${build}/catalog.tsv.gz`,
  `${build}/catalog.meta.json`,
  `consumer-dna/${build}/rsids.json.gz`,
]);

// Use the prepared Genomewalk artifacts without rebuilding or changing rows.
// The small release file gives browser caches content-based identities.
export async function inspectReferences(directory: string) {
  const catalogs: Record<string, Omit<CatalogConfig, 'phase'>> = {};
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
  }
  return { schema: 1, catalogs };
}
