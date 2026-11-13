import { useEffect, useRef } from 'react';
import { Icon } from './Icons.jsx';

export function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  ready,
  busy,
  stopping,
  awaitingModel = false,
}) {
  const input = useRef(null);
  useEffect(() => {
    if (ready && !busy) input.current?.focus({ preventScroll: true });
  }, [ready, busy]);
  useEffect(() => {
    if (!input.current) return;
    input.current.style.height = 'auto';
    input.current.style.height = `${Math.min(input.current.scrollHeight + 2, 160)}px`;
  }, [value]);
  useEffect(() => {
    const node = input.current;
    let lastWidth = node.clientWidth;
    let frame;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth === lastWidth) return;
      lastWidth = node.clientWidth;
      cancelAnimationFrame(frame);
      // Resize outside the observer delivery to avoid a ResizeObserver loop.
      frame = requestAnimationFrame(() => {
        node.style.height = 'auto';
        node.style.height = `${Math.min(node.scrollHeight + 2, 160)}px`;
      });
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="composer-area">
      <form
        className={`composer ${!ready ? 'composer-disabled' : ''}`}
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && !busy) onSend();
        }}
      >
        <label className="sr-only" htmlFor="chat-input">
          Message Genomewalk AI
        </label>
        <textarea
          id="chat-input"
          ref={input}
          value={value}
          rows="1"
          disabled={!ready || busy}
          placeholder={
            awaitingModel
              ? 'Choose a local model to begin…'
              : ready
                ? 'Ask about your genome or follow up on an answer…'
                : 'Your assistant will be ready here…'
          }
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            ) {
              event.preventDefault();
              if (ready && !busy && value.trim()) onSend();
            }
          }}
          aria-describedby="input-help"
        />
        {busy ? (
          <button
            type="button"
            className="send-button stop-button"
            onClick={onStop}
            disabled={stopping}
            aria-label={stopping ? 'Stopping response' : 'Stop response'}
            title="Stop response"
          >
            <Icon name="stop" />
          </button>
        ) : (
          <button
            className="send-button"
            type="submit"
            disabled={!ready || busy || !value.trim()}
            aria-label="Send message"
            title="Send message"
          >
            <Icon name="arrow" />
          </button>
        )}
      </form>
      <div className="composer-meta">
        <span>
          <Icon name="shield" size={13} /> Questions, search, matches and answers stay on this
          device
        </span>
        <span id="input-help">
          Enter to send <span className="meta-divider">·</span> Shift + Enter for a new line
        </span>
      </div>
      <aside className="medical-disclaimer" aria-label="About these results">
        <strong>About these results</strong>
        <p>
          Variant annotations alone do not predict whether you will develop a condition or establish
          a diagnosis or increased personal risk. A genetics professional can interpret the findings
          alongside your health history and symptoms. AI interpretations can contain errors.
        </p>
      </aside>
    </div>
  );
}
