# Static-site validation — 12 November 2026

These are development and deployment checks, not a held-out model study or clinical validation. No personal genome was used in this pass.

## Automated checks

- `npm run check:release`: formatting, lint and all **110 tests passed**, followed by a production build and a static-output allowlist/integrity check.
- `npm audit --omit=dev`: no reported production dependency vulnerabilities at the time of this check.
- Both GRCh37/GRCh38 catalogs, metadata and consumer lookup files were copied unchanged from Genomewalk and checked against their hashes/bindings.
- HG002 matches Genomewalk's bundled file byte-for-byte: 42,067,644 bytes; SHA-256 `c7f9d7a4781f1f0a8a42ec54b051d6b95db1935c5e12318bae219740f9c50dc8`.
- Static-server tests cover raw gzip bytes, HEAD, byte ranges, JavaScript/WASM MIME types, project prefixes, missing paths and rejected POST requests.
- The old `/api/*` and `/lininforet` paths return 404. There is no application API fallback.

## Production browser checks

Used the in-app Chromium browser, serving actual `dist/` files with the file-only preview server:

| Check                             | Result                                                                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root URL `/`                      | Intake loads; no answer model loads automatically.                                                                                                                         |
| HG002 public sample               | Catalog, matching and embedding preparation complete; **426 usable matches**.                                                                                              |
| Docker-exported `/genomewalk-ai/` | Same sample completes preparation; public references, sample, JS workers and WASM use the correct path prefix.                                                             |
| Synthetic 23andMe TXT, GRCh37     | Provider/build detected; one deliberately constructed match; search index ready.                                                                                           |
| Synthetic AncestryDNA TXT, GRCh38 | Provider/build detected; one deliberately constructed match; search index ready.                                                                                           |
| Qwen3.5 9B                        | Loads from the static root app after explicit selection.                                                                                                                   |
| Direct question                   | “Do I have variants related to hearing loss?” completes all four request steps and displays two WFS1 records, with genotype, classification, frequencies and source links. |
| Follow-up                         | “What does conflicting classification mean for these two records?” completes and refers to the same two WFS1 records.                                                      |
| Browser error logs                | No errors recorded in the successful root and project-path runs.                                                                                                           |

Synthetic consumer files use invented homozygous calls at a public catalog position, not donated or personal DNA. They check parser/data delivery, not clinical accuracy. The project-path server observed GETs for static assets and reference files; this is not a comprehensive browser network/privacy audit.

The generated openings were not clinically reviewed. The direct answer used the phrase “associated with” for a listed catalog condition; the follow-up added a diagnostic caveat. These observations are retained, not treated as proof of answer accuracy. No prompts or model-specific behavior were changed during this static-delivery work, and other answer models were not retested.

## Failures found and corrected

1. HG002 initially failed build detection because its VCF declares chromosome lengths without an explicit GRCh38 reference tag. Reused Genomewalk's build detector, which recognizes reference labels and primary-chromosome lengths and rejects conflicting evidence.
2. The next run had zero usable matches because the previous matcher required `FILTER=PASS`, while HG002 uses `.` for unfiltered calls. Aligned with Genomewalk's policy: accept `PASS` or `.`, exclude named failed filters. The original filter is retained; `.` is not relabeled as PASS. Sample filters, complete supported genotypes and duplicate-call consistency are still checked.
3. Bumped the match-cache pipeline version so earlier results are recomputed. Added regression tests for build signatures/conflicts and unfiltered calls.

## Docker and publication preparation

Both `site` and `export` targets build successfully. Formatting, tests and compilation run with Docker build networking disabled after dependency installation. The optional file-serving container runs as UID 1000 and contains `dist/`, the preview script and package metadata; it has no application server, installed dependencies or environment file.

GitHub Pages workflow files, MIT licensing and ignore rules are prepared. No repository was created, no code was pushed and nothing was published. Deployment on the eventual public host still needs its own smoke check after setup.
