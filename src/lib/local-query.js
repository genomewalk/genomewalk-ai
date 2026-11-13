import { LOCAL_QUERY_PROMPT } from '../prompts/embeddings.js';
import { PLAN_LABELS } from '../config/search-scope.js';
import { QUERY_GENERATION } from '../config/embeddings.js';
import { conversationMessages, fitConversation } from './conversation-context.js';

export function parseLocalQuery(text) {
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

export function buildLocalQueryContext(question, previous, profile) {
  return fitConversation(previous, profile, (history) => ({
    messages: conversationMessages(LOCAL_QUERY_PROMPT, question, history),
    generation: QUERY_GENERATION,
  }));
}
