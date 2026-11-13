export const PLAN_LABELS = Object.freeze({
  search: 'Specific topic',
  overview: 'All matches',
  other: 'Other',
});

export const QUERY_SCHEMA = Object.freeze({
  anyOf: Object.keys(PLAN_LABELS).map((mode) => ({
    type: 'object',
    additionalProperties: false,
    properties: {
      mode: { type: 'string', enum: [mode] },
      query:
        mode === 'search'
          ? { type: 'string', minLength: 1, maxLength: 1000 }
          : { type: 'string', enum: [''] },
    },
    required: ['mode', 'query'],
  })),
});
