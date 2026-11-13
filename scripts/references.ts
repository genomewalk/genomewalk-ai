import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { inspectReferences, REFERENCE_FILES } from './lib/references.ts';
import { verifiedFile } from './lib/files.ts';
import { EXAMPLE_GENOME } from '../src/config/example-genome.ts';

const [command, source] = process.argv.slice(2);
const target = resolve('public/ref');
if (command === 'sync' && source) {
  const root = resolve(source, 'public/ref');
  const release = await inspectReferences(root);
  for (const file of REFERENCE_FILES) {
    await mkdir(dirname(join(target, file)), { recursive: true });
    await copyFile(join(root, file), join(target, file));
  }
  await writeFile(join(target, 'release.json'), JSON.stringify(release, null, 2) + '\n');
  console.log('Copied and verified the prepared Genomewalk references for both builds.');
} else if (command === 'check') {
  const actual = await inspectReferences(target);
  const expected = JSON.parse(await readFile(join(target, 'release.json'), 'utf8'));
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      'Reference release differs from its files. Run data:sync after updating Genomewalk.',
    );
  if (!(await verifiedFile(join('public/samples', EXAMPLE_GENOME.name), EXAMPLE_GENOME))) {
    throw new Error(
      'The public HG002 sample is missing or differs from the pinned Genomewalk sample.',
    );
  }
  console.log('Public references and HG002 sample match their recorded fingerprints.');
} else {
  throw new Error('Use: npm run data:sync -- /path/to/genomewalk OR npm run data:check');
}
