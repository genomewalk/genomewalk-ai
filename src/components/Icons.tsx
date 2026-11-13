import type { SVGProps } from 'react';
const paths = {
  close: <path d="m6 6 12 12M6 18 18 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M12 19V5m-6 6 6-6 6 6" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  catalog: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 7h6M9 12h6M9 17h6" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  server: (
    <>
      <rect x="3" y="3" width="18" height="7" rx="2" />
      <rect x="3" y="14" width="18" height="7" rx="2" />
      <path d="M7 6.5h.01M7 17.5h.01M12 6.5h5M12 17.5h5" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
    </>
  ),
  browser: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M2 9h20M6 6.5h.01M9 6.5h.01" />
    </>
  ),
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 6 6" />
    </>
  ),
  chat: <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z" />,
  dna: (
    <>
      <path d="M6 2c0 10 12 10 12 20M18 2c0 10-12 10-12 20M7 5h10M9 9h6M9 15h6M7 19h10" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  folder: (
    <>
      <path d="M3 9V5a1 1 0 0 1 1-1h5l2 3h8a1 1 0 0 1 1 1v2" />
      <path d="M3 10h18l-3 10H3V10Z" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  chip: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="3" />
      <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
      <rect x="10" y="10" width="4" height="4" rx="1" />
    </>
  ),
  sparkle: (
    <>
      <path d="m12 3 2.8 6.2L21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8L12 3Z" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />,
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1" />
    </>
  ),
};
export function Icon({
  name,
  size = 20,
  ...props
}: SVGProps<SVGSVGElement> & { name: keyof typeof paths; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}

export function BrandMark() {
  return (
    <svg viewBox="0 0 40 40" className="brand-mark" aria-hidden="true">
      <rect width="40" height="40" rx="12" fill="currentColor" />
      <g fill="none" stroke="var(--paper)" strokeWidth="1.8" strokeLinecap="round">
        <path d="M13 9c0 11 14 11 14 22M27 9c0 11-14 11-14 22M14 12h12M15 28h10M18 19h4" />
      </g>
    </svg>
  );
}
