// Application review policy, not a clinical-risk score or ClinVar standard.
// Exact codes from Genomewalk's prepared `sig` column. Never infer a code from
// gene names, conditions, classification prose or conflicting submission text.
export const CATALOG_CLASS_PRIORITY = Object.freeze({
  P: Object.freeze({ value: 1, order: 0, label: 'Pathogenic' }),
  PLP: Object.freeze({ value: 1, order: 0, label: 'Pathogenic / likely pathogenic' }),
  LP: Object.freeze({ value: 0.75, order: 1, label: 'Likely pathogenic' }),
  C: Object.freeze({ value: 0.5, order: 2, label: 'Conflicting classifications' }),
  O: Object.freeze({ value: 0.25, order: 3, label: 'Other catalog classification' }),
});
export const UNKNOWN_CLASS_PRIORITY = Object.freeze({
  value: 0,
  order: 4,
  label: 'Unknown or missing classification code',
});

// Exploratory settings, not fitted weights or a clinical-risk score.
export const DEFAULT_WEIGHTS = Object.freeze({ classification: 0.15, review: 0.04 });
export const PREVIEW_LIMIT = 24; // Display only; never a retrieval cutoff.
export const FORMULA =
  'similarity + classification weight × class value + review weight × (stars / 4)';

export function validateWeights(weights) {
  for (const name of ['classification', 'review']) {
    if (
      typeof weights?.[name] !== 'number' ||
      !Number.isFinite(weights[name]) ||
      weights[name] < 0 ||
      weights[name] > 1
    ) {
      throw new Error('Ranking weights must be numbers between 0 and 1.');
    }
  }
  return { classification: weights.classification, review: weights.review };
}
