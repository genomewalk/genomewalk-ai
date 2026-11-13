// Retrieval math and public document construction are independent of inference.
const readable = (value) => (typeof value === 'string' ? value.replaceAll('_', ' ').trim() : '');
export function searchDocument(row) {
  return [
    row.gene && `Gene: ${readable(row.gene)}.`,
    row.rsids && `Variant: ${row.rsids}.`,
    row.conditions && `Conditions: ${readable(row.conditions)}.`,
    row.classification && `ClinVar: ${readable(row.classification)}.`,
    row.conflictingclassifications &&
      `Conflicting submissions: ${readable(row.conflictingclassifications)}.`,
  ]
    .filter(Boolean)
    .join('\n');
}
export function cosineSimilarity(a, b) {
  if (a.length !== b.length || !a.length) throw new Error('Embedding dimensions do not match.');
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] ** 2;
    bb += b[i] ** 2;
  }
  if (!Number.isFinite(dot + aa + bb) || aa === 0 || bb === 0)
    throw new Error('Invalid embedding vector.');
  return dot / Math.sqrt(aa * bb);
}
