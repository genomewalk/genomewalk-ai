# Public reference maintenance

Genomewalk AI consumes the **same prepared data** as Genomewalk. Keep upstream download, filtering, catalog construction, frequency preparation and rsID-sidecar generation in the Genomewalk repository.

After running Genomewalk's documented data preparation and validation commands:

```sh
npm run data:sync -- /path/to/genomewalk
npm run check:release
```

Only these files are copied unchanged:

```text
public/ref/GRCh37/catalog.meta.json
public/ref/GRCh37/catalog.tsv.gz
public/ref/GRCh38/catalog.meta.json
public/ref/GRCh38/catalog.tsv.gz
public/ref/consumer-dna/GRCh37/rsids.json.gz
public/ref/consumer-dna/GRCh38/rsids.json.gz
```

`public/ref/release.json` records row counts and fingerprints of the catalogs, metadata and rsID sidecars. It is generated from those files for cache invalidation; it is not a separate catalog or filtering policy. Every copied catalog must match its existing metadata, and each lookup must bind to that catalog and build.

The Genomewalk modules under `src/vendor/genomewalk/` have pinned fingerprints. `provenance.json` records unchanged reference readers; `consumer-provenance.json` records the consumer parser and VCF build detector, including relocated imports and documented adapters. Provenance tests protect these copies from accidental edits. The small adapter in `src/lib/local-catalog.js` adds deployment prefixes and release checks, while using the original streaming reader, consumer parser and lookup validation.

The public sample is the same unmodified `HG002_GRCh38.vcf.gz` committed in Genomewalk. Its attribution and checksums are retained in `public/samples/README.md`; its size/hash are pinned in `src/config/example-genome.js`. It is served with the static app and verified both in release checks and in the browser before using matches. Normal builds neither download nor regenerate it.

This app uses the prepared, filtered catalog rather than every entry currently visible on the ClinVar website. Catalog dates, aggregate labels and publication links can differ from live record pages. Publication URLs do not supply full paper contents, and aggregate condition lists do not establish per-condition classifications.

VCF build detection uses Genomewalk’s reference declarations and chromosome-length signatures. Its filter policy accepts `PASS` and `.` (filters not applied), preserving the original value; named failed filters are excluded. Complete supported genotypes and consistent duplicate calls remain required before an AI answer can use a match.
