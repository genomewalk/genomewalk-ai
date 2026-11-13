# Static deployment

The artifact is `dist/`. There are no server functions, upload handlers, secrets or runtime environment variables. Serve the entire directory over HTTPS, including `.wasm`, `.mjs`, public reference files and the HG002 sample.

## Docker, following Genomewalk

- `dependencies`: Node 24 and `npm ci` from the lockfile.
- `source`: allowlisted app code, tests and checked-in public data.
- `build`: formatting, lint, unit/integration tests, reference checks, Vite compilation and output checks, with networking disabled.
- `export`: a scratch target containing only the published files.
- `site`: an optional unprivileged Node file server, with only `dist/` and preview code. It has no application logic or installed dependencies.

```sh
docker build --target site -t genomewalk-ai .
docker run --rm -p 127.0.0.1:5173:5173 genomewalk-ai
```

The running container needs no volume, environment file, genome file or access to the Genomewalk checkout. All personal processing remains in the visiting browser.

## GitHub Pages

The workflow follows Genomewalk's checkout → Docker export → Pages artifact → deployment pattern. Pull requests build and check without publishing; `main` publishes. Action revisions are pinned to the same revisions used by Genomewalk.

It is configured for `genomewalk/genomewalk-ai`, at `/genomewalk-ai/`:

```sh
docker build --target export --build-arg BASE_PATH=/genomewalk-ai/ \
  --output type=local,dest=dist .
```

GitHub Pages uses GitHub Actions as its publishing source. Pushing to `main` runs the checks and publishes the exported artifact at [genomewalk.github.io/genomewalk-ai/](https://genomewalk.github.io/genomewalk-ai/).

For a future root/custom domain, change the build argument to `/` and configure the domain separately. Vite's `base` rewrites bundled assets; `publicFile()` applies the same prefix to reference and sample fetches, including those made inside workers. This follows [Vite's static deployment guidance](https://vite.dev/guide/static-deploy).

## Hosting requirements

- Use HTTPS for WebGPU, except localhost development.
- Serve `.gz` data unchanged with `application/gzip`; do not add gzip HTTP encoding to already-compressed files. Integrity checks need the original bytes.
- Serve `.wasm` as `application/wasm` and `.mjs` as JavaScript.
- Revalidate `ref/release.json` and catalog metadata when updated. Deploy the complete build atomically so catalogs and metadata agree.
- Unknown routes, including the retired `/lininforet` and `/api/*`, are ordinary 404s. No SPA wildcard routing is required.

The static preview supports GET, HEAD and byte ranges. Static files are public; private file access is never exposed by the app.
