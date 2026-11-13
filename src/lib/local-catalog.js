import { loadCatalogue } from '../vendor/genomewalk/catalogues/catalogue-stream.ts';
import { matchingRows } from '../vendor/genomewalk/catalogues/rows.ts';
import { loadLookup } from '../vendor/genomewalk/consumer-dna/lookup/index.ts';
import { orderCatalogMatches } from './evidence-order.js';
import { referenceFetcher } from './public-files.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

// Genomewalk's unchanged metadata/BGZF/SHA-256 download pipeline. Exhaust its
// iterator before publishing anything; late CRC/hash/order failures discard all.
export async function loadCatalogKeys(
  config,
  { signal, fetchImpl = fetch, onProgress = () => {} } = {},
) {
  const fetchReference = referenceFetcher(fetchImpl);
  // The sidecar's content fingerprint also binds saved consumer matches to this
  // exact release. Genomewalk's reader validates its build and catalog binding.
  const fetchLookup = async (path, options) => {
    const response = await fetchReference(path, options);
    if (!response.ok) return response;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytesToHex(sha256(bytes)) !== config.catalog.lookupRevision)
      throw new Error('The rsID reference does not match this release. Reload and try again.');
    return new Response(bytes, { status: response.status, headers: response.headers });
  };
  const catalogue = await loadCatalogue(
    config.localGenome?.build ?? 'GRCh38',
    signal,
    onProgress,
    fetchReference,
  );
  if (catalogue.source.sha256 !== config.catalog.sha256)
    throw new Error('The local catalog changed. Refresh local files before matching.');
  const candidates = [];
  let row = 0;
  for await (const line of catalogue.rows(signal, (p) =>
    onProgress(`Downloading and checking the Genomewalk catalog · ${Math.round(p * 100)}%`),
  )) {
    const [chrom, pos, ref, alt] = line.split('\t', 4);
    candidates.push({
      citation: `C${++row}`,
      rowNumber: row + 1,
      chrom,
      pos: Number(pos),
      ref,
      alt,
    });
  }
  const lookup =
    config.localGenome?.format === 'consumer'
      ? await loadLookup(catalogue.build, 'catalog', catalogue.source, signal, fetchLookup)
      : null;
  return {
    candidates,
    catalogue,
    lookup,
    source: { sha256: catalogue.source.sha256, build: catalogue.build },
    total: catalogue.n,
  };
}

export async function hydrateGenomewalkMatches(result, catalogue, signal, onProgress) {
  const key = (row) => [row.chrom, row.pos, row.ref, row.alt].join(':');
  // The same second-pass helper Genomewalk uses for unordered VCF matching:
  // retain matched payloads only; exhaust and verify the entire download again.
  const selected = await matchingRows(
    catalogue,
    new Set([...result.matches, ...result.issues].map(key)),
    signal,
    onProgress,
  );
  const columns = catalogue.header.slice(1).split('\t');
  const merge = (row) => {
    const line = selected.get(key(row));
    if (!line) throw new Error('A matched annotation is missing from the verified catalog.');
    const cells = line.split('\t');
    const annotation = Object.fromEntries(columns.map((name, i) => [name, cells[i] ?? '']));
    // Decode the catalog's integer enum exactly; missing stars must not become 0.
    const stars = ['0', '1', '2', '3', '4'].includes(annotation.stars)
      ? Number(annotation.stars)
      : null;
    return {
      ...row,
      ...annotation,
      build: catalogue.build,
      pos: Number(annotation.pos),
      stars,
      citation: row.citation,
      call: row.call,
    };
  };
  return {
    ...result,
    matches: orderCatalogMatches(result.matches.map(merge)),
    issues: orderCatalogMatches(result.issues.map(merge)),
  };
}
