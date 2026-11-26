import type { SearchPlan } from '../lib/types.ts';

export const RECORD_LIMIT = { overview: 3, topic: 5 } as const;
export const recordLimit = (plan?: SearchPlan) =>
  plan?.overview ? RECORD_LIMIT.overview : RECORD_LIMIT.topic;
export const EVIDENCE_ANSWER = Object.freeze({ maxTokens: 2048 });
