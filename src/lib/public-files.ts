import type { CatalogConfig } from './types.ts';
import type { Fetcher } from '../vendor/genomewalk/io/types.ts';
// Vite supplies the deployment prefix, including GitHub Pages project paths.
export function publicFile(path: string, base = import.meta.env?.BASE_URL ?? '/') {
  return `${base}${path.replace(/^\//, '')}`;
}

// Keep Genomewalk's readers unchanged while supporting a deployment subdirectory.
export function referenceFetcher(fetchImpl: Fetcher = fetch): Fetcher {
  return (path, options) => fetchImpl(typeof path === 'string' ? publicFile(path) : path, options);
}

export async function loadReferenceConfig(
  build: string | undefined,
  { signal, fetchImpl = fetch }: { signal?: AbortSignal; fetchImpl?: Fetcher } = {},
): Promise<CatalogConfig> {
  if (!['GRCh37', 'GRCh38'].includes(build ?? ''))
    throw new Error('Choose a supported genome build.');
  const response = await fetchImpl(publicFile('/ref/release.json'), { cache: 'no-cache', signal });
  if (!response.ok) throw new Error('The public reference could not be loaded. Please try again.');
  const release = (await response.json()) as {
    schema: number;
    catalogs?: Record<string, CatalogConfig>;
  };
  const catalog = release.catalogs?.[build!];
  const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (
    release.schema !== 1 ||
    !catalog ||
    catalog.build !== build ||
    !Number.isSafeInteger(catalog.rows) ||
    catalog.rows < 1 ||
    !hash(catalog.sha256) ||
    !hash(catalog.cacheKey) ||
    !hash(catalog.lookupRevision)
  ) {
    throw new Error('The public reference release is invalid. Please reload the page.');
  }
  signal?.throwIfAborted();
  return { ...catalog, phase: 'ready' };
}
