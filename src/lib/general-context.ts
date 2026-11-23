import type { ModelProfile, GenomeSource } from './types.ts';
import type { ConversationTurn } from './conversation-context.ts';
import { GENERAL_ANSWER_PROMPT, FOLLOWUP_ANSWER_PROMPT } from '../prompts/general-answer.ts';
import { genomeProvenance } from './genome-provenance.ts';
import { EVIDENCE_ANSWER } from '../config/evidence-answer.ts';
import { conversationMessages, fitConversation } from './conversation-context.ts';

export function buildGeneralContext(
  question: string,
  previous: ConversationTurn[],
  profile: ModelProfile,
  { followup = false, genomeSource }: { followup?: boolean; genomeSource?: GenomeSource } = {},
) {
  return fitConversation(followup ? previous : [], profile, (history) => ({
    messages: conversationMessages(
      followup ? FOLLOWUP_ANSWER_PROMPT : GENERAL_ANSWER_PROMPT,
      followup
        ? JSON.stringify({ genomeSource: genomeProvenance(genomeSource), latestQuestion: question })
        : question,
      history,
    ),
    generation: {
      max_tokens: EVIDENCE_ANSWER.maxTokens,
      presence_penalty: 0,
      repetition_penalty: 1,
    },
  }));
}
