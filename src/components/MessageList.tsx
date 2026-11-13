import type { ChatMessage } from '../lib/session-types.ts';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { Icon } from './Icons.tsx';
import { MarkdownResponse, ResponseSource } from './MarkdownResponse.ts';
import { EmbeddingsEvidence } from './EmbeddingsEvidence.tsx';

const outputBudget = (message: ChatMessage) =>
  Math.max(
    0,
    Math.min(
      message.journey?.steps.find((step) => step.id === 'answer')?.data?.opening?.request
        ?.max_tokens ?? message.model!.contextWindowTokens,
      message.model!.contextWindowTokens - message.usage!.prompt_tokens,
    ),
  );

export function MessageList({ messages, busy }: { messages: ChatMessage[]; busy: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const lastUserId = [...messages].reverse().find((message) => message.role === 'user')?.id;
  useLayoutEffect(() => {
    following.current = true;
  }, [lastUserId]);
  useLayoutEffect(() => {
    if (following.current && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages]);
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      if (following.current) node.scrollTop = node.scrollHeight;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="message-scroll"
      ref={scroller}
      onScroll={(event) => {
        const node = event.currentTarget;
        following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100;
      }}
    >
      <div
        className="message-list"
        role="log"
        aria-label="Conversation"
        aria-live="polite"
        aria-relevant="additions text"
        aria-busy={busy}
      >
        {messages.map((message) => (
          <article
            key={message.id}
            className={`message message-${message.role}`}
            aria-label={message.role === 'user' ? 'You' : 'Genomewalk AI'}
          >
            <div className="message-byline">
              {message.role === 'assistant' && <Icon name="sparkle" size={15} />}
              <span>
                {message.role === 'user'
                  ? 'You'
                  : message.general
                    ? 'Genomewalk · conversation'
                    : 'Genomewalk · local semantic review'}
              </span>
            </div>
            {message.role === 'assistant' && <EmbeddingsEvidence message={message} />}
            {message.role === 'assistant' &&
              (message.content || message.status !== 'streaming') && (
                <div className="local-answer-heading">
                  <Icon name="chip" size={17} />
                  <strong>
                    {message.model!.shortLabel} ·{' '}
                    {message.general ? 'conversation answer' : 'answer'}
                  </strong>
                  <span>
                    {message.status === 'streaming'
                      ? 'Writing on your device…'
                      : message.status === 'error'
                        ? 'Could not finish'
                        : message.status === 'stopped'
                          ? 'Stopped'
                          : message.limited
                            ? 'Token limit reached'
                            : message.evidenceAnswer
                              ? 'From matched records'
                              : message.general
                                ? 'Conversation · no new record search'
                                : 'Generated on your device'}
                  </span>
                </div>
              )}
            {(message.content || message.status !== 'streaming') && (
              <div
                className={`message-bubble ${message.evidenceAnswer ? 'evidence-answer' : ''} ${message.status === 'error' ? 'message-failed' : ''}`}
              >
                {message.content ? (
                  message.role === 'assistant' ? (
                    <MarkdownResponse content={message.content} />
                  ) : (
                    message.content
                  )
                ) : message.status === 'stopped' ? (
                  'Response stopped.'
                ) : (
                  'No response was generated.'
                )}
                {message.content && message.status === 'streaming' && (
                  <span className="stream-cursor" aria-hidden="true" />
                )}
              </div>
            )}
            {message.role === 'assistant' && message.content && (
              <ResponseSource content={message.content} evidenceAnswer={message.evidenceAnswer} />
            )}
            {message.usage && message.status !== 'streaming' && (
              <p className="message-note local-token-usage">
                {message.status === 'stopped'
                  ? 'Stopped'
                  : message.limited
                    ? 'Limit reached'
                    : message.finishReason === 'stop'
                      ? 'Ended normally'
                      : 'Stream ended'}{' '}
                · {message.usage.completion_tokens.toLocaleString()} output tokens
                {
                  <>
                    {' '}
                    / {outputBudget(message).toLocaleString()} available ·{' '}
                    {message.usage!.prompt_tokens.toLocaleString()} input tokens.
                  </>
                }{' '}
                Counts from WebLLM.
              </p>
            )}
            {message.status === 'error' && (
              <p className="message-note">
                This reply failed. This turn is excluded from local history.
              </p>
            )}
            {message.status === 'stopped' && message.content && (
              <p className="message-note">
                You stopped this response. This partial answer is excluded from local history.
              </p>
            )}
            {message.limited && (
              <p className="message-note">
                Output/context limit reached.{' '}
                {message.general
                  ? 'This partial explanation is excluded from local history. Ask a more focused question.'
                  : 'No incomplete record selection is used for an answer. Please try again with a more focused question.'}
              </p>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
