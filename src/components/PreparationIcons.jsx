// Lucide icons: https://lucide.dev/icons/ (ISC / MIT).
// Original license is preserved in src/assets/lucide-license.txt and in diagram exports.
const icons = {
  database: (
    <>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5V19A9 3 0 0 0 21 19V5" />
      <path d="M3 12A9 3 0 0 0 21 12" />
    </>
  ),
  server: (
    <>
      <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
      <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
      <line x1="6" x2="6.01" y1="6" y2="6" />
      <line x1="6" x2="6.01" y1="18" y2="18" />
    </>
  ),
  dna: (
    <>
      <path d="m10 16 1.5 1.5" />
      <path d="m14 8-1.5-1.5" />
      <path d="M15 2c-1.798 1.998-2.518 3.995-2.807 5.993" />
      <path d="m16.5 10.5 1 1" />
      <path d="m17 6-2.891-2.891" />
      <path d="M2 15c6.667-6 13.333 0 20-6" />
      <path d="m20 9 .891.891" />
      <path d="M3.109 14.109 4 15" />
      <path d="m6.5 12.5 1 1" />
      <path d="m7 18 2.891 2.891" />
      <path d="M9 22c1.798-1.998 2.518-3.995 2.807-5.993" />
    </>
  ),
  cpu: (
    <>
      <path d="M12 20v2" />
      <path d="M12 2v2" />
      <path d="M17 20v2" />
      <path d="M17 2v2" />
      <path d="M2 12h2" />
      <path d="M2 17h2" />
      <path d="M2 7h2" />
      <path d="M20 12h2" />
      <path d="M20 17h2" />
      <path d="M20 7h2" />
      <path d="M7 20v2" />
      <path d="M7 2v2" />
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="8" y="8" width="8" height="8" rx="1" />
    </>
  ),
  search: (
    <>
      <path d="m21 21-4.34-4.34" />
      <circle cx="11" cy="11" r="8" />
    </>
  ),
  'shield-check': (
    <>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  'panels-top-left': (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18" />
      <path d="M9 21V9" />
    </>
  ),
  'cloud-download': (
    <>
      <path d="M12 13v8l-4-4" />
      <path d="m12 21 4-4" />
      <path d="M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284" />
    </>
  ),
};

export function PreparationIcon({ name, x, y, size = 32, color = '#587D53' }) {
  return (
    <svg
      x={x}
      y={y}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name]}
    </svg>
  );
}
