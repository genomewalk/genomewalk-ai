import type { CatalogRow } from './types.ts';
// Retrieval math and public document construction are independent of inference.
const readable = (value: unknown) =>
  typeof value === 'string' ? value.replaceAll('_', ' ').trim() : '';
export function searchDocument(row: Partial<CatalogRow>) {
  const rsIds = row.rsids
    ?.split('|')
    .map((id) => id.trim().replace(/^(?:rs)?([1-9]\d*)$/i, 'rs$1'))
    .join('|');
  // Search identifies the subject. Full annotations, including frequencies,
  // classifications and review information, remain in the answer's source records.
  return [
    row.conditions && `Conditions: ${readable(row.conditions).replaceAll('|', '; ')}.`,
    row.gene && `Gene: ${readable(row.gene).replaceAll('|', ', ')}.`,
    rsIds && `Variant: ${rsIds.replaceAll('|', ', ')}.`,
  ]
    .filter(Boolean)
    .join(' ');
}
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>) {
  if (a.length !== b.length || !a.length) throw new Error('Embedding dimensions do not match.');
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    aa += a[i]! ** 2;
    bb += b[i]! ** 2;
  }
  if (!Number.isFinite(dot + aa + bb) || aa === 0 || bb === 0)
    throw new Error('Invalid embedding vector.');
  return dot / Math.sqrt(aa * bb);
}
