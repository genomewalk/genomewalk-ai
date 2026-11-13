# Genomewalk AI

A private, conversational guide to your genome. Ask questions about your DNA and explore ClinVar annotations, gnomAD frequencies, and linked publications. Genome matching, search, and AI run locally in your browser. Your DNA and conversations stay on your device.

This is a **static website**, built with React and Vite. Like [Genomewalk](https://github.com/genomewalk/genomewalk), it serves prepared public reference files and a public GIAB sample alongside the app. There is no application API, upload endpoint, cloud inference, database server, or API key.

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
2. **Understand the question:** the selected local model chooses Specific topic, All matches, or Other, using available conversation history.
3. **Retrieve:** topic search combines semantic similarity with catalog classification and review stars in one score. An overview orders all usable matches by catalog fields. Other answers without new retrieval.
4. **Answer:** at most three new records enter the context, with complete earlier turns that fit. The model selects supplied record IDs and writes a short opening. The app displays the selected source facts and links unchanged.

There are no question-keyword, gene-name, or disease-specific routing rules. General explanations use model knowledge; personal variant facts come from the verified reference. This design limits factual rewriting, but the generated opening and general answers can still be wrong.

[Architecture, ranking and privacy boundaries](docs/ARCHITECTURE.md).

## Code map

| Location                                       | Responsibility                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/components/`                              | Genome intake, chat, source evidence and step diagrams                                  |
| `src/styles/`                                  | Chat layout, journey panels and genome intake styling                                   |
| `src/lib/embeddings-session.js`                | Preparation and question lifecycle; cancellation and conversation history               |
| `src/lib/genome-source.js`, `genome.worker.js` | Local file identification, hashing and matching                                         |
| `src/lib/local-catalog.js`, `public-files.js`  | Static references, validation and deployment paths                                      |
| `src/lib/embeddings.worker.js`                 | Local embedding index and cosine similarity                                             |
| `src/lib/evidence-ranking.js`                  | Shared field-based retrieval policy                                                     |
| `src/lib/evidence-answer.js`                   | Record selection, short opening and exact source rendering                              |
| `src/lib/local-model-session.js`, `webllm.js`  | Model selection, worker lifetime and inference                                          |
| `src/config/`, `src/prompts/`                  | Model profiles, budgets, ranking weights and shared prompts                             |
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

Synchronization copies only the two prepared catalogs, their metadata and consumer rsID sidecars. It checks sizes, SHA-256 hashes and lookup bindings, then records a small static release manifest. Saved matches are invalidated when the genome, reference content or matcher version changes. [Reference maintenance](docs/REFERENCES.md).

## Development

```sh
npm test              # Synthetic fixtures and exact source checks; no live LLM
npm run lint         # JavaScript/React correctness and unused code
npm run format       # Consistent source formatting (vendor files stay untouched)
npm run check:release
```

Tests use synthetic calls, with public annotations where documented. Passing tests are software verification, not clinical validation. Browser smoke checks are recorded separately in [validation notes](docs/VALIDATION.md).

Do not commit personal genomes, answers, API keys or local research output. Ignore rules and the Docker context protect those local files; the published output is additionally checked against a file allowlist. Historical development studies remain outside the live app and deployment.

## License

Application code is [MIT licensed](LICENSE), matching Genomewalk. Public datasets and model weights retain their own terms and attribution. See [third-party notices](THIRD_PARTY_NOTICES.md).
