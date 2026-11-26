import type { MatchedRow, SemanticHit } from './types.ts';
import {
  CATALOG_CLASS_LABELS,
  DISEASE_CLASS_ORDER,
  REVIEW_GROUPS,
} from '../config/evidence-ranking.ts';

interface RankingFields {
  sig?: unknown;
  stars?: unknown;
  rowNumber?: number;
}
export function catalogPriority<T extends RankingFields>(row: T) {
  const classification =
    typeof row.sig === 'string' && Object.hasOwn(CATALOG_CLASS_LABELS, row.sig)
      ? CATALOG_CLASS_LABELS[row.sig as keyof typeof CATALOG_CLASS_LABELS]
      : 'Unknown or missing classification code';
  return {
    sig: row.sig ?? null,
    classification,
    reviewStars:
      typeof row.stars === 'number' &&
      Number.isInteger(row.stars) &&
      row.stars >= 0 &&
      row.stars <= 4
        ? row.stars
        : null,
  };
}

// Topic relevance is ColBERT MaxSim only. Catalog order breaks exact ties.
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

function reviewPriority(row: MatchedRow) {
  const disease = DISEASE_CLASS_ORDER.indexOf(row.sig ?? '');
  const priority = catalogPriority(row);
  const stars = priority.reviewStars;
  const group = disease < 0 ? 2 : (stars ?? 0) >= 2 ? 0 : 1;
  return { group, priority, disease };
}

export function catalogReviewGroup(row: MatchedRow) {
  return REVIEW_GROUPS[reviewPriority(row).group]!;
}

// Stable ties retain match order, as in Genomewalk. The summary and overview use this same order.
export function rankCatalogForReview(matches: readonly MatchedRow[]) {
  return matches
    .map((row, index) => ({ index, ...reviewPriority(row) }))
    .sort(
      (a, b) =>
        a.group - b.group ||
        (b.priority.reviewStars ?? 0) - (a.priority.reviewStars ?? 0) ||
        a.disease - b.disease,
    )
    .map((hit, index) => ({ ...hit, rank: index + 1 }));
}
