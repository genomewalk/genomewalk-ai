import type { ReactNode } from 'react';
import type { ModelMessage } from '../lib/types.ts';
import { useState } from 'react';
import { Icon } from './Icons.tsx';

// Shared building blocks for the step side panels.
export function Disclosure({
  title,
  note,
  children,
  className = '',
}: {
  title: ReactNode;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className={`panel-disclosure ${className}`}
      onToggle={(event) => {
        if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        <Icon name="chevron" size={14} />
        <span className="panel-disclosure-title">{title}</span>
        {note && <span className="panel-disclosure-note">{note}</span>}
      </summary>
      {open && <div>{children}</div>}
    </details>
  );
}

export function Stats({ items }: { items: [label: string, value: ReactNode][] }) {
  return (
    <dl className="panel-stats">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// Exact text sent to or returned by the local model.
export function RawText({ label, children }: { label?: string; children: string }) {
  return (
    <div className="panel-raw">
      {label && <span>{label}</span>}
      <pre tabIndex={0}>{children}</pre>
    </div>
  );
}

export function RawMessages({ messages }: { messages: ModelMessage[] }) {
  return messages.map((message, index) => (
    <RawText key={index} label={message.role}>
      {message.content}
    </RawText>
  ));
}
