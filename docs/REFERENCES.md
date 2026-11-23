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
public/ref/publications/index.json
public/ref/publications/<shard>.<sha256>.json.gz
```

`public/ref/release.json` records row counts and fingerprints of the catalogs, metadata, rsID sidecars and publication manifest. It is generated from those files for cache invalidation; it is not a separate catalog or filtering policy. Every copied catalog must match its existing metadata, and each lookup must bind to that catalog and build. Publication checks verify all 64 shard hashes, label counts and exact PMID coverage across both catalogs.

Run `npm run data:publications` in Genomewalk before syncing a release that needs new citation labels. Its existing pipeline supplies compact author/journal/year labels, such as “Kurima et al., Nature genetics 2002”, with explicit missing-metadata entries. Genomewalk AI copies these files unchanged and reuses its `PublicationCatalogue` reader, including integrity checks, session caching, a four-request concurrency limit and retryable failed downloads. No second metadata builder is maintained here. Normal builds and Docker exports remain network-free after dependencies are installed.

Before a record answer, only the static shards needed for the candidate citations are downloaded from the app's host. Questions, genome calls and PMID lists are not sent to a PubMed API. Available labels enter the local answer context and Model input inspector; absent or failed metadata retains the original PMID link. These are citation labels, not paper titles, abstracts or evidence of paper conclusions. Genome matching, ranking and saved match data are unchanged.

The Genomewalk modules under `src/vendor/genomewalk/` have pinned fingerprints. `provenance.json` records unchanged reference readers; `consumer-provenance.json` records the consumer parser and VCF build detector, including relocated imports and documented adapters. Provenance tests protect these copies from accidental edits. The small adapter in `src/lib/local-catalog.ts` adds deployment prefixes and release checks, while using the original streaming reader, consumer parser and lookup validation.

The public sample is the same unmodified `HG002_GRCh38.vcf.gz` committed in Genomewalk. Its attribution and checksums are retained in `public/samples/README.md`; its size/hash are pinned in `src/config/example-genome.ts`. It is served with the static app and verified both in release checks and in the browser before using matches. Normal builds neither download nor regenerate it.

This app uses the prepared, filtered catalog rather than every entry currently visible on the ClinVar website. Catalog dates, aggregate labels and publication links can differ from live record pages. Publication URLs do not supply full paper contents, and aggregate condition lists do not establish per-condition classifications.

VCF build detection uses Genomewalk’s reference declarations and chromosome-length signatures. Its filter policy accepts `PASS` and `.` (filters not applied), preserving the original value; named failed filters are excluded. Complete supported genotypes and consistent duplicate calls remain required before an AI answer can use a match.
