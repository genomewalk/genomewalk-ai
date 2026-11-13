import { GENERAL_ANSWER_PROMPT } from '../prompts/general-answer.js';
import { conversationMessages, fitConversation } from './conversation-context.js';

export function buildGeneralContext(question, previous, profile) {
  return fitConversation(previous, profile, (history) => ({
    messages: conversationMessages(GENERAL_ANSWER_PROMPT, question, history),
    generation: { temperature: 0.2, top_p: 0.8, presence_penalty: 0, repetition_penalty: 1 },
  }));
}
