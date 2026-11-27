import type { ChatMessage } from '../lib/session-types.ts';
import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { Icon } from './Icons.tsx';
import { MarkdownResponse, ResponseSource } from './MarkdownResponse.ts';
import { EmbeddingsEvidence } from './EmbeddingsEvidence.tsx';

const outputBudget = (message: ChatMessage) =>
  Math.max(
    0,
    Math.min(
      message.journey?.steps.find((step) => step.id === 'context')?.data?.request?.max_tokens ??
        message.model!.contextWindowTokens,
      message.model!.contextWindowTokens - message.usage!.prompt_tokens,
    ),
  );

export function MessageList({ messages, busy }: { messages: ChatMessage[]; busy: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const lastUserId = messages.findLast((message) => message.role === 'user')?.id;
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
          <ConversationMessage key={message.id} message={message} />
        ))}
      </div>
    </div>
  );
}

const ConversationMessage = memo(function ConversationMessage({
  message,
}: {
  message: ChatMessage;
}) {
  const isAssistant = message.role === 'assistant';
  const streaming = message.status === 'streaming';
  const showBubble = !streaming || Boolean(message.content);
  return (
    <article
      className={`message message-${message.role}`}
      aria-label={isAssistant ? 'Genomewalk AI' : 'You'}
    >
      <div className="message-byline">
        {isAssistant && <Icon name="sparkle" size={15} />}
        <span>{isAssistant ? 'Genomewalk · local catalog review' : 'You'}</span>
      </div>
      {isAssistant && <EmbeddingsEvidence message={message} />}
      {isAssistant && showBubble && (
        <div className="local-answer-heading">
          <Icon name="chip" size={17} />
          <strong>{message.model!.shortLabel} · answer</strong>
          <span>
            {message.status === 'error'
              ? 'Could not finish'
              : message.status === 'stopped'
                ? 'Stopped'
                : message.evidenceAnswer
                  ? 'From matched records'
                  : 'Generated on your device'}
          </span>
        </div>
      )}
      {showBubble && (
        <div
          className={`message-bubble ${message.evidenceAnswer ? 'evidence-answer' : ''} ${message.status === 'error' ? 'message-failed' : ''}`}
        >
          {message.content ? (
            isAssistant ? (
              <MarkdownResponse content={message.content} />
            ) : (
              message.content
            )
          ) : message.status === 'stopped' ? (
            'Response stopped.'
          ) : (
            'No response was generated.'
          )}
        </div>
      )}
      {isAssistant && !streaming && message.content && <ResponseSource content={message.content} />}
      {message.usage && !streaming && (
        <p className="message-note local-token-usage">
          {message.status === 'stopped'
            ? 'Stopped'
            : message.finishReason === 'stop'
              ? 'Ended normally'
              : 'Stream ended'}{' '}
          · {message.usage.completion_tokens.toLocaleString()} output tokens /{' '}
          {outputBudget(message).toLocaleString()} available ·{' '}
          {message.usage.prompt_tokens.toLocaleString()} input tokens. Counts from WebLLM.
        </p>
      )}
      {message.status === 'error' && (
        <p className="message-note">This reply failed. This turn is excluded from local history.</p>
      )}
    </article>
  );
});
