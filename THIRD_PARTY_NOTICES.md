# Third-party notices

- **Genomewalk:** vendored parsing/validation modules and the adapted static preview server are MIT licensed, copyright 2026 Genomewalk contributors. The root MIT license includes that attribution. The provenance files in `src/vendor/genomewalk/` record source hashes and documented adaptations. Public references and the teaching sample are reused unchanged.
- **Lucide:** diagram/icon paths retain the ISC/MIT notices in `src/assets/lucide-license.txt`.
- **GIAB HG002:** credit NIST, the Genome in a Bottle Consortium and the T2T Q100 project. The sample's release, source links, checksums, recommended citation and data-use link are in `public/samples/README.md`.
- **ClinVar and gnomAD:** prepared reference data originates from these public resources. Their data terms and recommended citations remain applicable; the application MIT license does not relicense third-party datasets. See [ClinVar](https://www.ncbi.nlm.nih.gov/clinvar/) and [gnomAD](https://gnomad.broadinstitute.org/).
- **Model weights:** model files are downloaded from their configured public repositories, not included under this application's license. Qwen, Llama, DeepSeek and MiniLM retain the licenses attached to their respective releases. Exact models and revisions are identified in `src/config/models/` and `src/config/embeddings.js`.
- **Runtime dependencies:** React, Vite, WebLLM, Transformers.js and other dependencies retain the notices supplied by their packages. Exact versions are recorded in `package-lock.json`.
