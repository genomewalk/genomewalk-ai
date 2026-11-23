# Genomewalk AI

A private, conversational guide to your genome. Ask questions about your DNA and explore ClinVar annotations, gnomAD frequencies, and linked publications. Genome matching, search, and AI run locally in your browser. Your DNA and conversations stay on your device.

This is a **static website**, built with TypeScript, React and Vite. Like [Genomewalk](https://github.com/genomewalk/genomewalk), it serves prepared public reference files and a public GIAB sample alongside the app. There is no application API, upload endpoint, cloud inference, database server, or API key.

[Open Genomewalk AI](https://genomewalk.github.io/genomewalk-ai/) · [Source repository](https://github.com/genomewalk/genomewalk-ai)

## Run locally

Use Node.js 24 or later:

```sh
npm ci
npm run dev
```

Open <http://127.0.0.1:5173/>. Choose a local file or the **GIAB HG002** public sample, inspect preparation, then continue to chat. Choose an answer model explicitly; none loads on page load.

Supported inputs:

- Single-sample **GRCh38 VCF**, plain or gzip/BGZF compressed.
- Original **23andMe or AncestryDNA** exports: `.txt`, `.txt.gz`, or `.zip`, with a supported GRCh37/GRCh38 build and forward strand.
- The same checked-in **HG002 GRCh38 v5.0q** sample used by Genomewalk (42 MB). [Provenance and checksums](public/samples/README.md).

WebGPU and sufficient device memory are required for the answer models. Use localhost during development and HTTPS when deployed. Public model files download from Hugging Face and the WebLLM model library and can be cached by the browser.

## Build and preview

```sh
npm run check:release
npm run preview
```

`dist/` is the complete publishable site: HTML, JavaScript, CSS, WASM, references, and the public sample. The preview serves only files from that directory. It has no application endpoints.

```sh
# GitHub Pages project path; omit BASE_PATH for a root domain.
BASE_PATH=/genomewalk-ai/ npm run build
```

## Docker

Same pattern as Genomewalk: locked dependencies, a checked static build, a file-only runtime, and an export target for GitHub Pages.

```sh
# Build and serve locally. No genome file or credentials are mounted.
docker build --target site -t genomewalk-ai .
docker run --rm -p 127.0.0.1:5173:5173 genomewalk-ai

# Export the deployable files for the GitHub project path.
docker build --target export --build-arg BASE_PATH=/genomewalk-ai/ \
  --output type=local,dest=dist .
```

The build context is allowlisted. Checks and compilation run without network access after installing dependencies. The final image contains only the static output and the small preview server; it runs as an unprivileged user. [Deployment details](docs/DEPLOYMENT.md).

## The flow

1. **Prepare once:** read the selected file in a worker, match exact supported alleles to the public catalog, and embed the matched annotations locally.
2. **Understand the question:** the selected local model chooses Specific topic, Overview, General, or Follow-up, using available conversation history.
3. **Retrieve:** topic search orders matches by semantic similarity alone. Search text contains conditions, gene names and variant IDs; full annotations, including frequencies, remain available to the answer model. An overview orders all usable matches by catalog fields. General and Follow-up answer without retrieval.
4. **Answer:** Specific topic and Overview send up to three candidates as factual descriptions and source links, without old conversation. One answer call is instructed to discuss at most three relevant records. Follow-up receives only the previous conversation and question; General receives only the new question. The chat displays that generated response; original candidate fields remain available in Model input. There is no separate selector call. The three-record input cap is enforced by code; the three-record response limit is a model instruction.

There are no question-keyword, gene-name, or disease-specific routing rules. General explanations use model knowledge; new variant facts come from the verified reference; follow-ups rely on earlier generated conversation. Generated answers can misinterpret or omit evidence; original source fields and links remain available for inspection.

[Architecture, ranking and privacy boundaries](docs/ARCHITECTURE.md).

## Code map

| Location                                       | Responsibility                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/components/`                              | Genome intake, chat, source evidence and step diagrams                                  |
| `src/styles/`                                  | Chat layout, journey panels and genome intake styling                                   |
| `src/lib/embeddings-session.ts`                | Preparation and question lifecycle; cancellation and conversation history               |
| `src/lib/genome-source.ts`, `genome.worker.ts` | Local file identification, hashing and matching                                         |
| `src/lib/local-catalog.ts`, `public-files.ts`  | Static references, validation and deployment paths                                      |
| `src/lib/embeddings.worker.ts`                 | Local embedding index and cosine similarity                                             |
| `src/lib/evidence-ranking.ts`                  | Shared field-based retrieval policy                                                     |
| `src/lib/evidence-answer.ts`                   | Original record fields and compact answer descriptions with source links                |
| `src/lib/local-model-session.ts`, `webllm.ts`  | Model selection, worker lifetime and inference                                          |
| `src/config/`, `src/prompts/`                  | Model profiles, budgets, ranking policy and shared prompts                              |
| `src/vendor/genomewalk/`                       | Genomewalk parsing and validation modules, with documented adaptations and fingerprints |
| `public/ref/`, `public/samples/`               | Checked-in public data; no personal files                                               |
| `scripts/`                                     | Reference synchronization, release checks and static preview                            |
| `tests/`                                       | Matching, privacy boundaries, context, routing, rendering and static hosting checks     |

## Reference updates

Reuse Genomewalk's existing preparation pipeline. This repository does not maintain a second ClinVar/gnomAD builder.

```sh
# After preparing and checking a release in the Genomewalk checkout:
npm run data:sync -- /path/to/genomewalk
npm run check:release
```

Synchronization copies the two prepared catalogs, their metadata, consumer rsID sidecars and Genomewalk's prepared publication labels. It checks sizes, SHA-256 hashes, lookup bindings and publication coverage, then records a small static release manifest. Saved matches are invalidated when the genome, reference content or matcher version changes. Publication labels are added locally from static files; the browser never requests PubMed metadata. [Reference maintenance](docs/REFERENCES.md).

## Development

```sh
npm test              # Synthetic fixtures and exact source checks; no live LLM
npm run typecheck    # Strict TypeScript: app, workers, scripts and tests
npm run lint         # TypeScript/React correctness and unused code
npm run format       # Consistent source formatting (vendor files stay untouched)
npm run check:release
```

Source files use `.ts` / `.tsx`; `tsconfig.base.json` shares strict checks, including array bounds, across the app, build scripts and tests. Vite bundles the browser code; Node 24 runs the TypeScript scripts and tests directly. Docker and CI run the same checks before building.

Tests use synthetic calls, with public annotations where documented. Passing tests are software verification, not clinical validation. Browser smoke checks are recorded separately in [validation notes](docs/VALIDATION.md).

Do not commit personal genomes, answers, API keys or local research output. Ignore rules and the Docker context protect those local files; the published output is additionally checked against a file allowlist. Historical development studies remain outside the live app and deployment.

## License

Application code is [MIT licensed](LICENSE), matching Genomewalk. Public datasets and model weights retain their own terms and attribution. See [third-party notices](THIRD_PARTY_NOTICES.md).
