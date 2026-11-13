import { localContextBudget, LOCAL_TEMPLATE_RESERVE_TOKENS } from '../config/local-inference.js';

export const conversationMessages = (system, question, history) => [
  { role: 'system', content: system },
  ...history.flatMap((turn) => [
    { role: 'user', content: turn.question },
    { role: 'assistant', content: turn.answer },
  ]),
  { role: 'user', content: question },
];

// Keep the newest complete Q&A turns that fit a deterministic size budget.
// Source records and schemas count too; nothing is truncated or summarized.
export function fitConversation(previous, profile, build) {
  const budget = localContextBudget(profile);
  const measure = (history) => {
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
  let history = [],
    context = measure(history);
  if (context.inputBytes > context.inputByteLimit)
    throw new Error('The question and reference exceed this model’s context budget.');
  for (let i = previous.length - 1; i >= 0; i--) {
    const next = [previous[i], ...history],
      candidate = measure(next);
    if (candidate.inputBytes > candidate.inputByteLimit) break;
    history = next;
    context = candidate;
  }
  return context;
}
