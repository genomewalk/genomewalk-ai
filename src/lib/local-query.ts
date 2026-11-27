import type { ModelProfile, SearchPlan } from './types.ts';
import type { ConversationTurn } from './conversation-context.ts';
import { LOCAL_QUERY_PROMPT } from '../prompts/query.ts';
import { QUERY_GENERATION } from '../config/search.ts';
import { fitConversation } from './conversation-context.ts';

export function parseLocalQuery(text: string): SearchPlan {
  const plan = JSON.parse(text);
  if (plan && !Array.isArray(plan) && Object.keys(plan).length === 1) {
    if (plan.overview === true) return plan;
    if (typeof plan.query === 'string' && plan.query.trim() && plan.query.length <= 1000)
      return plan;
  }
  throw new Error('The local model returned an invalid search plan. Please try again.');
}

export function buildLocalQueryContext(
  question: string,
  previous: ConversationTurn[],
  profile: ModelProfile,
  summary: string,
) {
  return fitConversation(previous, profile, {
    system: `${summary}\n\n${LOCAL_QUERY_PROMPT}`,
    question,
    generation: QUERY_GENERATION,
  });
}
