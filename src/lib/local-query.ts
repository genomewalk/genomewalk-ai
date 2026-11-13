import type { ModelProfile, SearchPlan } from './types.ts';
import type { ConversationTurn } from './conversation-context.ts';
import { LOCAL_QUERY_PROMPT } from '../prompts/embeddings.ts';
import { PLAN_LABELS } from '../config/search-scope.ts';
import { QUERY_GENERATION } from '../config/embeddings.ts';
import { conversationMessages, fitConversation } from './conversation-context.ts';

export function parseLocalQuery(text: string): SearchPlan {
  const plan = JSON.parse(text);
  if (
    !plan ||
    Array.isArray(plan) ||
    Object.keys(plan).sort().join() !== 'mode,query' ||
    !Object.hasOwn(PLAN_LABELS, plan.mode) ||
    typeof plan.query !== 'string' ||
    plan.query.length > 1000 ||
    (plan.mode === 'search' ? !plan.query.trim() : plan.query !== '')
  ) {
    throw new Error('The local model returned an invalid search plan. Please try again.');
  }
  return plan;
}

export function buildLocalQueryContext(
  question: string,
  previous: ConversationTurn[],
  profile: ModelProfile,
) {
  return fitConversation(previous, profile, (history) => ({
    messages: conversationMessages(LOCAL_QUERY_PROMPT, question, history),
    generation: QUERY_GENERATION,
  }));
}
