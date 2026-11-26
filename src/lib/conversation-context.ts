import { localContextBudget, LOCAL_TEMPLATE_RESERVE_TOKENS } from '../config/local-inference.ts';
import type { Generation, ModelMessage, ModelProfile } from './types.ts';

export interface ConversationTurn {
  question: string;
  answer: string;
  identity?: string;
}

const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).byteLength;

// Reserve the fixed request first, then fit the newest complete Q&A turns.
export function fitConversation<G extends Generation>(
  previous: ConversationTurn[],
  profile: ModelProfile,
  { system, question, generation }: { system: string; question: string; generation: G },
) {
  const budget = localContextBudget(profile);
  let inputBytes =
    byteLength(system) +
    byteLength(question) +
    byteLength(generation.response_format?.schema ?? '');
  let inputByteLimit = budget.inputByteLimit;
  if (inputBytes > inputByteLimit)
    throw new Error('The question and reference exceed this model’s context budget.');

  let firstTurn = previous.length;
  while (firstTurn > 0) {
    const turn = previous[firstTurn - 1]!;
    const nextInputBytes = inputBytes + byteLength(turn.question) + byteLength(turn.answer);
    const nextByteLimit = inputByteLimit - 2 * LOCAL_TEMPLATE_RESERVE_TOKENS;
    if (nextInputBytes > nextByteLimit) break;
    inputBytes = nextInputBytes;
    inputByteLimit = nextByteLimit;
    firstTurn--;
  }

  const messages: ModelMessage[] = [{ role: 'system', content: system }];
  for (const turn of previous.slice(firstTurn)) {
    messages.push(
      { role: 'user', content: turn.question },
      { role: 'assistant', content: turn.answer },
    );
  }
  messages.push({ role: 'user', content: question });
  return {
    ...budget,
    messages,
    generation,
    inputBytes,
    inputByteLimit,
    historyTurns: previous.length - firstTurn,
    omittedHistoryTurns: firstTurn,
    submitted: false,
  };
}
