// Vite supplies the deployment prefix, including GitHub Pages project paths.
export function publicFile(path, base = import.meta.env?.BASE_URL ?? '/') {
  return `${base}${path.replace(/^\//, '')}`;
}

// Keep Genomewalk's readers unchanged while supporting a deployment subdirectory.
export function referenceFetcher(fetchImpl = fetch) {
  return (path, options) => fetchImpl(publicFile(path), options);
}

export async function loadReferenceConfig(build, { signal, fetchImpl = fetch } = {}) {
  if (!['GRCh37', 'GRCh38'].includes(build)) throw new Error('Choose a supported genome build.');
  const response = await fetchImpl(publicFile('/ref/release.json'), { cache: 'no-cache', signal });
  if (!response.ok) throw new Error('The public reference could not be loaded. Please try again.');
  const release = await response.json();
  const catalog = release.catalogs?.[build];
  const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (
    release.schema !== 1 ||
    catalog?.build !== build ||
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
