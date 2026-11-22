// Application review policy, not a clinical-risk score or ClinVar standard.
// Exact codes from Genomewalk's prepared `sig` column. Never infer a code from
// gene names, conditions, classification prose or conflicting submission text.
export const CATALOG_CLASS_PRIORITY = Object.freeze({
  P: Object.freeze({ order: 0, label: 'Pathogenic' }),
  PLP: Object.freeze({ order: 0, label: 'Pathogenic / likely pathogenic' }),
  LP: Object.freeze({ order: 1, label: 'Likely pathogenic' }),
  C: Object.freeze({ order: 2, label: 'Conflicting classifications' }),
  O: Object.freeze({ order: 3, label: 'Other catalog classification' }),
});
export const UNKNOWN_CLASS_PRIORITY = Object.freeze({
  order: 4,
  label: 'Unknown or missing classification code',
});

export const PREVIEW_LIMIT = 24; // Display only; never a retrieval cutoff.
