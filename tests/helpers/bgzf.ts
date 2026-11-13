// BGZF fixture helper copied from Genomewalk tests/helpers/vcf.ts (types removed).
import { deflateRawSync, crc32 } from 'node:zlib';

/** Synthetic BGZF bytes exercise the real browser reader, not a substituted parser. */
export function bgzfBytes(text: string, chunkSize = 65280) {
  const input = Buffer.from(text),
    parts = [];
  for (let offset = 0; offset < input.length; offset += chunkSize) {
    const chunk = input.subarray(offset, offset + chunkSize);
    const compressed = deflateRawSync(chunk);
    const block = Buffer.alloc(26 + compressed.length);
    block.set([31, 139, 8, 4, 0, 0, 0, 0, 0, 255, 6, 0, 66, 67, 2, 0]);
    block.writeUInt16LE(block.length - 1, 16);
    compressed.copy(block, 18);
    block.writeUInt32LE(crc32(chunk) >>> 0, block.length - 8);
    block.writeUInt32LE(chunk.length, block.length - 4);
    parts.push(block);
  }
  return Buffer.concat(parts);
}
