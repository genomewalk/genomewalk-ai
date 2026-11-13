import type { ModelProfile, ModelMessage, Generation } from './types.ts';
import type { compactMatch } from './match-reference.ts';

export interface ConversationTurn {
  question: string;
  answer: string;
  identity?: string;
  records?: ReturnType<typeof compactMatch>[];
}
interface ConversationRequest {
  messages: ModelMessage[];
  generation?: Generation;
}
import { localContextBudget, LOCAL_TEMPLATE_RESERVE_TOKENS } from '../config/local-inference.ts';

export const conversationMessages = (
  system: string,
  question: string,
  history: ConversationTurn[],
): ModelMessage[] => [
  { role: 'system', content: system },
  ...history.flatMap((turn) => [
    { role: 'user' as const, content: turn.question },
    { role: 'assistant' as const, content: turn.answer },
  ]),
  { role: 'user', content: question },
];

// Keep the newest complete Q&A turns that fit a deterministic size budget.
// Source records and schemas count too; nothing is truncated or summarized.
export function fitConversation<T extends ConversationRequest>(
  previous: ConversationTurn[],
  profile: ModelProfile,
  build: (history: ConversationTurn[]) => T,
) {
  const budget = localContextBudget(profile);
  const measure = (history: ConversationTurn[]) => {
    const request = build(history);
    const text = [
      ...request.messages.map((m) => m.content),
      request.generation?.response_format?.schema ?? '',
    ];
    const inputBytes = text.reduce((n, value) => n + new TextEncoder().encode(value).length, 0);
    const inputByteLimit =
      budget.inputByteLimit - history.length * 2 * LOCAL_TEMPLATE_RESERVE_TOKENS;
    return {
      ...budget,
      ...request,
      inputBytes,
      inputByteLimit,
      historyTurns: history.length,
      omittedHistoryTurns: previous.length - history.length,
      submitted: false,
    };
  };
  let history: ConversationTurn[] = [];
  let context = measure(history);
  if (context.inputBytes > context.inputByteLimit)
    throw new Error('The question and reference exceed this model’s context budget.');
  for (let i = previous.length - 1; i >= 0; i--) {
    const next = [previous[i]!, ...history],
      candidate = measure(next);
    if (candidate.inputBytes > candidate.inputByteLimit) break;
    history = next;
    context = candidate;
  }
  return context;
}
