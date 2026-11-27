import type { ChatMessage, JourneyStep, StepId } from '../lib/session-types.ts';
import { useId } from 'react';
import { DiagramIcon as Icon } from './DiagramIcons.tsx';
import {
  ArrowMarker,
  CARD,
  DIAGRAM_WIDTH,
  StepCard,
  ink,
  line,
  muted,
  tones,
} from './DiagramParts.tsx';
import { recordLimit } from '../config/evidence-answer.ts';
import iconLicense from '../assets/lucide-license.txt?raw';

const count = (value: number | null | undefined) => (value == null ? '—' : value.toLocaleString());
const FIRST_CARD = 142;
const HEIGHT = FIRST_CARD + 4 * CARD.height + 3 * CARD.gap + 20;

export function RequestDiagram({ message, selected }: { message: ChatMessage; selected: number }) {
  const id = useId();
  const steps = Object.fromEntries(message.journey!.steps.map((step) => [step.id, step])) as Record<
    StepId,
    JourneyStep
  >;
  const plan = steps.query.data?.response;
  const context = message.context;
  const stages = [
    {
      step: steps.query,
      title: 'Understand the question',
      illustration: 'question' as const,
      tone: tones.blue,
      description: ['Use the catalog summary', 'and recent conversation.'],
      value: plan?.overview ? 'Catalog overview' : plan ? 'Search query ready' : 'Preparing query…',
      detail: 'Your latest question takes priority.',
    },
    {
      step: steps.semantic,
      title: 'Find relevant matches',
      illustration: 'search' as const,
      tone: tones.violet,
      description: plan?.overview
        ? ['Use the leading matches', 'in catalog review order.']
        : ['Order matches by similarity', 'to the search topic.'],
      value: `${count(steps.semantic.data?.total)} matches considered`,
      detail: `Up to ${context?.maxNewRecords ?? recordLimit(plan)} new records for the answer.`,
    },
    {
      step: steps.context,
      title: 'Prepare the model input',
      illustration: 'input' as const,
      tone: tones.amber,
      description: ['Question, summary, conversation', 'and candidate records.'],
      value: `${count(context?.included)} candidate records`,
      detail: context
        ? `Earlier exchanges: ${count(context.historyTurns)} · ${context.submitted ? 'passed to the model' : 'not passed yet'}`
        : 'Fits within the model’s available space.',
    },
    {
      step: steps.answer,
      title: 'Build the answer',
      illustration: 'answer' as const,
      tone: tones.green,
      description: ['The local model answers using', 'conversation and relevant records.'],
      value: 'One answer call',
      detail: 'Details and links come from source records.',
    },
  ];
  const arrowX = CARD.x + 58;
  return (
    <figure className="step-diagram" tabIndex={0} aria-label="Request flow diagram">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={DIAGRAM_WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${DIAGRAM_WIDTH} ${HEIGHT}`}
        role="img"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        fontFamily="Arial, Helvetica, sans-serif"
      >
        <title id={`${id}-title`}>
          From your question to a local answer — step {selected + 1} of 4
        </title>
        <desc id={`${id}-description`}>
          {stages.map((stage) => `${stage.title}: ${stage.value}. ${stage.detail}`).join(' ')} All
          processing shown happens in your browser.
        </desc>
        <metadata>{iconLicense}</metadata>
        <defs>
          <ArrowMarker id={`${id}-arrow`} color="#9CA3AF" />
        </defs>
        <rect
          x="0.5"
          y="0.5"
          width={DIAGRAM_WIDTH - 1}
          height={HEIGHT - 1}
          rx="18"
          fill="#FAFBFC"
          stroke={line}
        />
        <Icon name="panels-top-left" x={20} y={17} size={22} color={muted} />
        <text x="52" y="34" fill={ink} fontSize="16" fontWeight="700">
          Your browser
        </text>
        <Icon
          name="shield-check"
          x={DIAGRAM_WIDTH - 164}
          y={20}
          size={16}
          color={tones.green.main}
        />
        <text x={DIAGRAM_WIDTH - 20} y="33" textAnchor="end" fill={muted} fontSize="12">
          Stays on your device
        </text>
        <path d={`M0 54H${DIAGRAM_WIDTH}`} stroke={line} />
        <rect x={CARD.x} y="70" width={CARD.width} height="44" rx="22" fill="#FFF" stroke={line} />
        <text x={DIAGRAM_WIDTH / 2} y="97" textAnchor="middle" fill={ink} fontSize="14">
          Your question + recent conversation
        </text>
        {stages.map((stage, i) => {
          const y = FIRST_CARD + i * (CARD.height + CARD.gap);
          return (
            <g key={stage.step.id}>
              <path
                d={`M${arrowX} ${y - CARD.gap + 3}V${y - 3}`}
                stroke="#9CA3AF"
                strokeWidth="2"
                markerEnd={`url(#${id}-arrow)`}
              />
              <StepCard
                y={y}
                number={i + 1}
                title={stage.title}
                illustration={stage.illustration}
                tone={stage.tone}
                state={i === selected ? 'current' : i < selected ? 'past' : 'later'}
                status={stage.step.status}
                description={stage.description}
              >
                <text x="120" y="98" fill={ink} fontSize="15" fontWeight="700">
                  {stage.value}
                </text>
                <text x="120" y="118" fill={muted} fontSize="13">
                  {stage.detail}
                </text>
              </StepCard>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
