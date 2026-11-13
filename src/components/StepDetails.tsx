import type { ReactNode } from 'react';
import { useState } from 'react';

export function Disclosure({
  title,
  children,
  className = '',
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className={`local-disclosure ${className}`}
      onToggle={(event) => {
        if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
      }}
    >
      <summary>{title}</summary>
      {open && <div>{children}</div>}
    </details>
  );
}
