// Reused from Genomewalk: src/lib/view/conditions.ts.
const NO_COND = /^(not provided|not specified|see cases|none|unknown|\.|-)$/i;

export const condList = (conds: string) => [
  ...new Set(
    (conds || '')
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c && !NO_COND.test(c)),
  ),
];
