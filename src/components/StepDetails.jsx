import { useState } from 'react';

export function Disclosure({ title, children, className = '' }) {
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
