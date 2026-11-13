import {
  CATALOG_CLASS_PRIORITY,
  UNKNOWN_CLASS_PRIORITY,
  DEFAULT_WEIGHTS,
  validateWeights,
} from '../config/evidence-ranking.js';

export function catalogPriority(row) {
  const category =
    typeof row.sig === 'string' && Object.hasOwn(CATALOG_CLASS_PRIORITY, row.sig)
      ? CATALOG_CLASS_PRIORITY[row.sig]
      : UNKNOWN_CLASS_PRIORITY;
  return {
    sig: row.sig ?? null,
    classValue: category.value,
    classification: category.label,
    classificationOrder: category.order,
    reviewStars: Number.isInteger(row.stars) && row.stars >= 0 && row.stars <= 4 ? row.stars : null,
  };
}

// Broad questions have no topic similarity; use catalog fields across the full pool.
export function rankCatalogOverview(records) {
  return records
    .map((row, index) => ({ index, priority: catalogPriority(row) }))
    .sort(
      (a, b) =>
        a.priority.classificationOrder - b.priority.classificationOrder ||
        (b.priority.reviewStars ?? -1) - (a.priority.reviewStars ?? -1) ||
        (records[a.index].rowNumber ?? a.index) - (records[b.index].rowNumber ?? b.index) ||
        a.index - b.index,
    )
    .map((hit, index) => ({ ...hit, rank: index + 1 }));
}

// One combined sort over all usable matches. No question text enters this function.
export function rankCombined(hits, records, weights = DEFAULT_WEIGHTS) {
  const selectedWeights = validateWeights(weights);
  if (hits.length !== records.length)
    throw new Error('Combined ranking requires scores for every usable match.');
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
      const row = records[hit.index];
      const priority = catalogPriority(row);
      const classValue = priority.classValue;
      const reviewValue = (priority.reviewStars ?? 0) / 4;
      const classificationContribution = selectedWeights.classification * classValue;
      const reviewContribution = selectedWeights.review * reviewValue;
      return {
        index: hit.index,
        similarity: hit.similarity,
        priority,
        classValue,
        reviewValue,
        classificationContribution,
        reviewContribution,
        score: hit.similarity + classificationContribution + reviewContribution,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (records[a.index].rowNumber ?? a.index) - (records[b.index].rowNumber ?? b.index) ||
        a.index - b.index,
    )
    .map((hit, index) => ({ ...hit, rank: index + 1 }));
}
