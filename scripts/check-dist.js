import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectReferences, REFERENCE_FILES } from './lib/references.js';
import { verifiedFile } from './lib/files.js';
import { EXAMPLE_GENOME } from '../src/config/example-genome.js';

const root = process.argv[2] || 'dist';
const allowed = new Set([
  'index.html',
  'favicon.svg',
  '.nojekyll',
  'ref/release.json',
  'samples/README.md',
  ...REFERENCE_FILES.map((file) => `ref/${file}`),
  `samples/${EXAMPLE_GENOME.name}`,
]);
async function inspect(directory = '') {
  for (const item of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = directory ? `${directory}/${item.name}` : item.name;
    if (item.isSymbolicLink()) throw new Error(`Symlink in static output: ${path}`);
    if (item.isDirectory()) {
      await inspect(path);
    } else if (!allowed.has(path) && !/^assets\/[^/]+\.(?:js|mjs|wasm|css)$/.test(path)) {
      throw new Error(`Unexpected file in static output: ${path}`);
    } else if (/\.(?:js|html|css)$/.test(path)) {
      const text = await readFile(join(root, path), 'utf8');
      if (/\/Users\/|sk-or-v1-[a-f0-9]{32,}/.test(text))
        throw new Error(`Local path or credential in static output: ${path}`);
    }
  }
}
await inspect();
const references = await inspectReferences(join(root, 'ref'));
const release = JSON.parse(await readFile(join(root, 'ref/release.json'), 'utf8'));
if (JSON.stringify(references) !== JSON.stringify(release))
  throw new Error('Published reference release is inconsistent.');
if (!(await verifiedFile(join(root, 'samples', EXAMPLE_GENOME.name), EXAMPLE_GENOME)))
  throw new Error('Published GIAB sample failed verification.');
console.log(
  'Static output verified: app assets, public references and the pinned GIAB sample only.',
);
