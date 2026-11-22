import type { SemanticHit } from './types.ts';
import { CATALOG_CLASS_PRIORITY, UNKNOWN_CLASS_PRIORITY } from '../config/evidence-ranking.ts';

interface RankingFields {
  sig?: unknown;
  stars?: unknown;
  rowNumber?: number;
}
export function catalogPriority<T extends RankingFields>(row: T) {
  const category =
    typeof row.sig === 'string' && Object.hasOwn(CATALOG_CLASS_PRIORITY, row.sig)
      ? CATALOG_CLASS_PRIORITY[row.sig as keyof typeof CATALOG_CLASS_PRIORITY]
      : UNKNOWN_CLASS_PRIORITY;
  return {
    sig: row.sig ?? null,
    classification: category.label,
    classificationOrder: category.order,
    reviewStars:
      typeof row.stars === 'number' &&
      Number.isInteger(row.stars) &&
      row.stars >= 0 &&
      row.stars <= 4
        ? row.stars
        : null,
  };
}

// Broad questions have no topic similarity; use catalog fields across the full pool.
export function rankCatalogOverview<T extends RankingFields>(records: T[]) {
  return records
    .map((row, index) => ({ index, priority: catalogPriority(row) }))
    .sort(
      (a, b) =>
        a.priority.classificationOrder - b.priority.classificationOrder ||
        (b.priority.reviewStars ?? -1) - (a.priority.reviewStars ?? -1) ||
        (records[a.index]!.rowNumber ?? a.index) - (records[b.index]!.rowNumber ?? b.index) ||
        a.index - b.index,
    )
    .map((hit, index) => ({ ...hit, rank: index + 1 }));
}

// Topic relevance is cosine similarity only. Catalog order breaks exact ties.
export function rankSemantic<T extends RankingFields>(hits: SemanticHit[], records: T[]) {
  if (hits.length !== records.length)
    throw new Error('Semantic ranking requires scores for every usable match.');
  const seen = new Set();
  return hits
    .map((hit) => {
      if (
        !Number.isInteger(hit.index) ||
        hit.index < 0 ||
        !records[hit.index] ||
        seen.has(hit.index) ||
        !Number.isFinite(hit.similarity)
      )
        throw new Error('Invalid full-pool search score.');
      seen.add(hit.index);
      const row = records[hit.index]!;
      const priority = catalogPriority(row);
      return {
        index: hit.index,
        similarity: hit.similarity,
        priority,
        score: hit.similarity,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (records[a.index]!.rowNumber ?? a.index) - (records[b.index]!.rowNumber ?? b.index) ||
        a.index - b.index,
    )
    .map((hit, index) => ({ ...hit, rank: index + 1 }));
}
