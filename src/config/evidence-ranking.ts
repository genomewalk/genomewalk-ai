// Classification labels for displaying a hit in the search inspector.
export const CATALOG_CLASS_LABELS = {
  P: 'Pathogenic',
  PLP: 'Pathogenic / likely pathogenic',
  LP: 'Likely pathogenic',
  C: 'Conflicting classifications',
  O: 'Other catalog classification',
} as const;

// Genomewalk's review order for complete, carried calls.
export const DISEASE_CLASS_ORDER = ['P', 'PLP', 'LP'];
export const REVIEW_GROUPS = [
  'Review first',
  'Less-reviewed disease claims',
  'Other ClinVar matches',
];

export const PREVIEW_LIMIT = 24;
