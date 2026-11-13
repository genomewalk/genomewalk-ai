import type { ModelProfile } from './types.ts';
import type { ConversationTurn } from './conversation-context.ts';
import { GENERAL_ANSWER_PROMPT } from '../prompts/general-answer.ts';
import { conversationMessages, fitConversation } from './conversation-context.ts';

export function buildGeneralContext(
  question: string,
  previous: ConversationTurn[],
  profile: ModelProfile,
) {
  return fitConversation(previous, profile, (history) => ({
    messages: conversationMessages(GENERAL_ANSWER_PROMPT, question, history),
    generation: { temperature: 0.2, top_p: 0.8, presence_penalty: 0, repetition_penalty: 1 },
  }));
}
