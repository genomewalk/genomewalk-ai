export const QUERY_SCHEMA = {
  anyOf: [
    {
      type: 'object',
      properties: { overview: { const: true } },
      required: ['overview'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { query: { type: 'string', minLength: 1, maxLength: 1000 } },
      required: ['query'],
      additionalProperties: false,
    },
  ],
} as const;
