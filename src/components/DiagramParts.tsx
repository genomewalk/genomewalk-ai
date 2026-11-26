import type { ReactNode } from 'react';
import type { StepStatus } from '../lib/session-types.ts';
import { STEP_STATUS } from './RequestProgress.tsx';

// Shared look for the step-panel diagrams. Sizes are fixed pixels: the figure
// scrolls in a narrow panel and never rescales with the panel width.
export const DIAGRAM_WIDTH = 500;
export const CARD = { x: 20, width: 460, height: 132, gap: 28 };
export const ink = '#1F2A37',
  muted = '#6B7280',
  line = '#E5E7EB';
export const tones = {
  blue: { main: '#4F7FE8', soft: '#C7D9FB', tint: '#EEF4FF' },
  violet: { main: '#8468E0', soft: '#D9D0F8', tint: '#F4F1FE' },
  amber: { main: '#D9902B', soft: '#F8DDB0', tint: '#FFF7E8' },
  green: { main: '#2F9E7A', soft: '#BFE8D8', tint: '#EAF8F2' },
  coral: { main: '#E0714F', soft: '#F8CFC2', tint: '#FFF1EC' },
};
export type Tone = (typeof tones)[keyof typeof tones];

// Original illustrations drawn for this app on a 72 × 72 canvas.
const art = {
  question: ({ main, soft }: Tone) => (
    <>
      <path
        d="M14 6h36a8 8 0 0 1 8 8v18a8 8 0 0 1-8 8H30l-10 9v-9h-6a8 8 0 0 1-8-8V14a8 8 0 0 1 8-8z"
        fill="#FFF"
        stroke={main}
        strokeWidth="2"
      />
      <text x="32" y="31" textAnchor="middle" fontSize="22" fontWeight="700" fill={main}>
        ?
      </text>
      <rect x="26" y="54" width="42" height="14" rx="7" fill={main} />
      <rect x="33" y="60" width="22" height="2.5" rx="1.25" fill="#FFF" />
      <circle cx="62" cy="10" r="3" fill={soft} />
      <circle cx="10" cy="60" r="4" fill={soft} />
    </>
  ),
  search: ({ main, soft }: Tone) => (
    <>
      {[4, 26, 48].map((y, i) => (
        <g key={y}>
          <rect
            x="4"
            y={y}
            width="50"
            height="18"
            rx="5"
            fill={i === 1 ? soft : '#FFF'}
            stroke={i === 1 ? main : soft}
            strokeWidth="2"
          />
          <rect x="11" y={y + 8} width={i === 1 ? 30 : 22} height="2.5" rx="1.25" fill={main} />
        </g>
      ))}
      <circle cx="52" cy="48" r="12" fill="#FFF" stroke={main} strokeWidth="3" />
      <path d="M61 57l8 8" stroke={main} strokeWidth="4" strokeLinecap="round" />
    </>
  ),
  input: ({ main, soft }: Tone) => (
    <>
      <rect x="10" y="2" width="52" height="68" rx="7" fill="#FFF" stroke={main} strokeWidth="2" />
      {[tones.blue.main, '#9CA3AF', tones.violet.main, tones.violet.main].map((color, i) => (
        <g key={i}>
          <circle cx="21" cy={15 + i * 14} r="4" fill={color} />
          <rect
            x="30"
            y={13.5 + i * 14}
            width={i === 1 ? 18 : 24}
            height="3"
            rx="1.5"
            fill={soft}
          />
        </g>
      ))}
    </>
  ),
  answer: ({ main, soft }: Tone) => (
    <>
      <rect x="6" y="8" width="52" height="60" rx="7" fill="#FFF" stroke={main} strokeWidth="2" />
      <rect x="15" y="19" width="26" height="4" rx="2" fill={main} />
      {[31, 40, 58].map((y) => (
        <rect key={y} x="15" y={y} width={y === 40 ? 26 : 34} height="3" rx="1.5" fill={soft} />
      ))}
      <rect x="15" y="49" width="20" height="3" rx="1.5" fill={tones.blue.main} />
      <path
        d="M60 0l3 7 7 3-7 3-3 7-3-7-7-3 7-3z"
        fill={main}
        stroke="#FFF"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </>
  ),
  catalog: ({ main, soft }: Tone) => (
    <>
      <path d="M10 14v44c0 5 12 9 26 9s26-4 26-9V14" fill="#FFF" stroke={main} strokeWidth="2" />
      <path
        d="M10 29c0 5 12 9 26 9s26-4 26-9M10 44c0 5 12 9 26 9s26-4 26-9"
        fill="none"
        stroke={soft}
        strokeWidth="2"
      />
      <ellipse cx="36" cy="14" rx="26" ry="9" fill={soft} stroke={main} strokeWidth="2" />
    </>
  ),
  match: ({ main, soft }: Tone) => (
    <>
      {[4, 44].map((x) => (
        <rect
          key={x}
          x={x}
          y="4"
          width="24"
          height="56"
          rx="6"
          fill="#FFF"
          stroke={soft}
          strokeWidth="2"
        />
      ))}
      {[14, 26, 38, 50].map((y, i) => (
        <g key={y}>
          <rect x="9" y={y - 2} width="14" height="4" rx="2" fill={i % 2 ? soft : main} />
          <rect x="49" y={y - 2} width="14" height="4" rx="2" fill={i % 2 ? soft : main} />
          {i % 2 === 0 && (
            <path d={`M28 ${y}h16`} stroke={main} strokeWidth="2" strokeDasharray="3 3" />
          )}
        </g>
      ))}
      <circle cx="58" cy="60" r="11" fill={tones.green.main} stroke="#FFF" strokeWidth="2" />
      <path
        d="M53 60l4 4 7-8"
        fill="none"
        stroke="#FFF"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  index: ({ main, soft }: Tone) => (
    <>
      <rect x="2" y="2" width="60" height="60" rx="8" fill="#FFF" stroke={soft} strokeWidth="2" />
      {Array.from({ length: 16 }, (_, i) => (
        <circle
          key={i}
          cx={12 + (i % 4) * 13}
          cy={12 + Math.floor(i / 4) * 13}
          r="4"
          fill={[1, 6, 8, 11, 14].includes(i) ? main : soft}
        />
      ))}
      <circle cx="52" cy="52" r="11" fill="#FFF" stroke={main} strokeWidth="3" />
      <path d="M60 60l8 8" stroke={main} strokeWidth="4" strokeLinecap="round" />
    </>
  ),
};
export type Art = keyof typeof art;

export function ArrowMarker({ id, color }: { id: string; color: string }) {
  return (
    <marker
      id={id}
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto"
    >
      <path
        d="M1 1L9 5L1 9"
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </marker>
  );
}

// One step: illustration on the left; number, title, status and text on the right.
// Steps after the one being viewed are faded.
export function StepCard({
  y,
  number,
  title,
  illustration,
  tone,
  state,
  status,
  description,
  children,
}: {
  y: number;
  number: number;
  title: string;
  illustration: Art;
  tone: Tone;
  state: 'past' | 'current' | 'later';
  status: StepStatus;
  description: string[];
  children?: ReactNode;
}) {
  const current = state === 'current';
  return (
    <g transform={`translate(${CARD.x} ${y})`} opacity={state === 'later' ? 0.45 : 1}>
      <rect
        width={CARD.width}
        height={CARD.height}
        rx="14"
        fill="#FFF"
        stroke={current ? tone.main : line}
        strokeWidth={current ? 2 : 1}
      />
      <rect x="10" y="10" width="96" height={CARD.height - 20} rx="10" fill={tone.tint} />
      <g transform="translate(22 30)">{art[illustration](tone)}</g>
      <circle cx="131" cy="26" r="11" fill={current ? tone.main : tone.tint} />
      <text
        x="131"
        y="30.5"
        textAnchor="middle"
        fontSize="12"
        fontWeight="700"
        fill={current ? '#FFF' : ink}
      >
        {number}
      </text>
      <text x="150" y="31" fontSize="16" fontWeight="700" fill={ink}>
        {title}
      </text>
      <text x={CARD.width - 16} y="30" textAnchor="end" fontSize="12" fill={muted}>
        {STEP_STATUS[status]}
      </text>
      {description.map((text, i) => (
        <text key={i} x="120" y={54 + i * 18} fontSize="13.5" fill={muted}>
          {text}
        </text>
      ))}
      {children}
    </g>
  );
}
