import type { CatalogRow } from './types.ts';
// Stable initial order for hydrated catalog matches. Question-specific review
// ordering is applied later by evidence-ranking.ts.
export function orderCatalogMatches<T extends CatalogRow>(rows: T[]) {
  const classes: Record<string, number> = { P: 0, PLP: 0, LP: 1, C: 2, O: 3 };
  return [...rows].sort(
    (a, b) =>
      (classes[a.sig ?? ''] ?? 4) - (classes[b.sig ?? ''] ?? 4) ||
      (b.stars ?? 0) - (a.stars ?? 0) ||
      Number(a.rowNumber) - Number(b.rowNumber),
  );
}
