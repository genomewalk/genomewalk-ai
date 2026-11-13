import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';

export async function fingerprint(path) {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`Expected a file: ${path}`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return { size: info.size, sha256: hash.digest('hex') };
}

export async function verifiedFile(path, expected) {
  try {
    const actual = await fingerprint(path);
    return actual.size === expected.bytes && actual.sha256 === expected.sha256;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
