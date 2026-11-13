// Stable initial order for hydrated catalog matches. Question-specific review
// ordering is applied later by evidence-ranking.js.
export function orderCatalogMatches(rows) {
  const classes = { P: 0, PLP: 0, LP: 1, C: 2, O: 3 };
  return [...rows].sort(
    (a, b) =>
      (classes[a.sig] ?? 4) - (classes[b.sig] ?? 4) ||
      (b.stars ?? 0) - (a.stars ?? 0) ||
      a.rowNumber - b.rowNumber,
  );
}
