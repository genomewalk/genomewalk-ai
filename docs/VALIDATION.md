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

This original static-delivery pass preceded publication. The repository has since been published at https://github.com/genomewalk/genomewalk-ai, with GitHub Pages at https://genomewalk.github.io/genomewalk-ai/.

## TypeScript migration — 13 November 2026

All owned application modules, React components, workers, configuration, build scripts and tests now use TypeScript. `npm run typecheck` checks the app, tooling and tests separately with strict mode and unchecked-index checks; Docker/CI run it as part of the release checks. No `allowJs`, `@ts-nocheck` or language-statistics overrides were added. The vendored Genomewalk modules, prepared references, source prompts and CSS are unchanged.

- Formatting, type checks, lint and all **110 tests passed**. Tests still exercise malformed untyped inputs at runtime; the intentional type errors are explicitly marked in those fixtures.
- Production build and static-output integrity/allowlist checks passed.
- Both Docker targets (`export` and `site`) built with Node **24.22.3**. The static container ran as UID **1000** and served HTTP 200. Release checks/build ran without networking after dependency installation.
- In-app browser at the root URL: public HG002 preparation completed with **426 matches** using saved matches and a rebuilt embedding index. No answer model loaded automatically.
- Fresh origin serving the Docker-exported `/genomewalk-ai/` path: catalog download, full sample matching and embedding preparation completed with **426 matches**. No answer model loaded automatically.
- Explicitly selected **Qwen3.5 9B** at the root URL. “Do I have variants related to hearing loss?” completed and displayed the two WFS1 records. “What does conflicting classification mean for these two records?” completed as a conversation follow-up, without a new search.
- No browser error logs appeared in either run. Other answer models were not rerun in this migration pass.

These are migration smoke checks, not an accuracy evaluation. The direct opening again described a listed condition as an association. The follow-up ambiguously described ClinVar versus “another source,” although the displayed classifications are within the supplied ClinVar annotation. The prompts and answer policy were not changed in this migration.

Type checking identified two library API mismatches: the feature-extraction pipeline ignored per-call truncation options, so the configured **256-token** bound is now applied to its tokenizer; gzip inspection now uses Pako’s public `onStart` stream callback instead of a private field. The concatenated-gzip, checksum and truncation tests passed, as did full HG002 matching. Embedding truncation can change similarity scores for long descriptions; clinical validation is still outstanding.
