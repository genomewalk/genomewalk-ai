import { useId } from 'react';
import { PreparationIcon as Icon } from './PreparationIcons.jsx';
import { PLAN_LABELS } from '../config/search-scope.js';
import { MAX_RECORDS } from '../config/evidence-answer.js';
import { STEP_STATUS } from './RequestProgress.jsx';
import iconLicense from '../assets/lucide-license.txt?raw';

const count = (value) => (value == null ? '—' : value.toLocaleString());
const ink = '#244C40',
  muted = '#64756C',
  green = '#587D53';

export function RequestDiagram({ message, selected }) {
  const id = useId();
  const steps = Object.fromEntries(message.journey.steps.map((step) => [step.id, step]));
  const plan = steps.query.data?.response;
  const context = message.context;
  const general = plan?.mode === 'other';
  const records = context?.recordReference?.records;
  const earlier = records?.filter((record) => record.origin === 'earlier').length;
  const selectedCount = message.answerSelection?.selected.length;
  const stages = [
    {
      step: steps.query,
      title: 'Understand the question',
      icon: 'cpu',
      description: ['The local model chooses', 'how to respond.'],
      value: plan ? PLAN_LABELS[plan.mode] : 'Choosing an approach…',
      detail: ['Your latest question takes priority.'],
    },
    {
      step: steps.semantic,
      title: general ? 'Continue the conversation' : 'Find relevant matches',
      icon: general ? 'cpu' : 'database',
      description: general
        ? ['No new search of your genome.']
        : plan?.mode === 'overview'
          ? ['Order the full match pool by', 'classification and review stars.']
          : ['Combine meaning, classification', 'and review stars.'],
      value: general
        ? 'No new variant records'
        : `${count(steps.semantic.data?.total)} matches considered`,
      detail: general
        ? ['Use the question and conversation.']
        : [`Up to ${context?.maxNewRecords ?? MAX_RECORDS} new records for the answer.`],
    },
    {
      step: steps.context,
      title: 'Prepare the model input',
      icon: 'database',
      description: general
        ? ['Question, instructions and', 'recent conversation.']
        : ['Question, instructions, conversation', 'and selected evidence.'],
      value: general
        ? 'Question + conversation'
        : `${count(context?.included)} new + ${count(earlier)} earlier records`,
      detail: context
        ? [
            `Earlier exchanges included: ${count(context.historyTurns)}`,
            context.submitted ? 'Passed to the local model' : 'Not passed to the model yet',
          ]
        : ['Fits within the model’s available space.'],
    },
    {
      step: steps.answer,
      title: 'Build the answer',
      icon: 'cpu',
      description: general
        ? ['The local model explains or', 'asks for clarification.']
        : ['The local model selects records', 'and writes a short opening.'],
      value: general ? 'Conversation response' : `${count(selectedCount)} records in the answer`,
      detail: general
        ? ['General explanations can use', 'model knowledge.']
        : ['Variant details and links come', 'from the source records.'],
    },
  ].slice(0, selected + 1);
  const width = selected === 0 ? 424 : 840;
  const height = selected < 2 ? 410 : 650;
  const positions = [
    [24, 160],
    [440, 160],
    [440, 400],
    [24, 400],
  ];
  const arrows = ['M212 126V157', 'M400 252H437', 'M628 350V397', 'M440 492H403'];
  return (
    <figure
      className="request-diagram"
      style={{ maxWidth: width, '--diagram-min-width': selected === 0 ? '340px' : '680px' }}
      tabIndex={0}
      aria-label="Request flow diagram"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        fontFamily="Arial, Helvetica, sans-serif"
      >
        <title id={`${id}-title`}>
          From your question to a local answer — step {selected + 1} of 4
        </title>
        <desc id={`${id}-description`}>
          {stages
            .map((stage) => `${stage.title}: ${stage.value}. ${stage.detail.join(' ')}`)
            .join(' ')}{' '}
          All processing shown happens in your browser.
        </desc>
        <metadata>{iconLicense}</metadata>
        <defs>
          <marker
            id={`${id}-arrow`}
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
              stroke={green}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </marker>
        </defs>
        <rect
          x="8"
          y="8"
          width={width - 16}
          height={height - 16}
          rx="18"
          fill="#F2F6EC"
          stroke="#B9C8AF"
        />
        <Icon name="panels-top-left" x={25} y={27} size={26} />
        <text x="64" y="47" fill={ink} fontSize="20" fontWeight="600">
          Your browser
        </text>
        <Icon name="shield-check" x={width - 212} y={30} size={20} />
        <text x={width - 182} y="46" fill={muted} fontSize="13">
          Stays on your device
        </text>
        <path d={`M8 64H${width - 8}`} stroke="#D4DFCB" />
        <rect x="24" y="82" width="376" height="44" rx="9" fill="#FFFEFA" stroke="#D3DBCD" />
        <text x="212" y="110" textAnchor="middle" fill={ink} fontSize="16">
          Your question + recent conversation
        </text>
        {stages.map((stage, i) => {
          const [x, y] = positions[i];
          const current = i === selected;
          return (
            <g key={stage.step.id} data-request-stage={i + 1}>
              <path
                d={arrows[i]}
                fill="none"
                stroke={green}
                strokeWidth="2"
                markerEnd={`url(#${id}-arrow)`}
              />
              <g transform={`translate(${x} ${y})`}>
                <rect
                  width="376"
                  height="190"
                  rx="13"
                  fill={current ? '#EAF1E0' : '#FFFEFA'}
                  stroke={current ? green : '#D3DBCD'}
                  strokeWidth={current ? 2 : 1}
                />
                <circle cx="27" cy="29" r="15" fill={current ? green : '#E7EFDC'} />
                <text
                  x="27"
                  y="35"
                  textAnchor="middle"
                  fill={current ? '#FFF' : ink}
                  fontSize="16"
                  fontWeight="600"
                >
                  {i + 1}
                </text>
                <text x="51" y="35" fill={ink} fontSize="18" fontWeight="600">
                  {stage.title}
                </text>
                {stage.description.map((line, n) => (
                  <text key={n} x="20" y={64 + n * 22} fill={muted} fontSize="16">
                    {line}
                  </text>
                ))}
                <Icon name={stage.icon} x={20} y={103} size={26} />
                <text x="57" y="124" fill={ink} fontSize="19" fontWeight="600">
                  {stage.value}
                </text>
                {stage.detail.map((line, n) => (
                  <text key={n} x="20" y={151 + n * 21} fill={muted} fontSize="15">
                    {line}
                  </text>
                ))}
              </g>
              <text x={x + 20} y={y + 210} fill={muted} fontSize="13">
                {current ? 'Viewing this step · ' : ''}
                {STEP_STATUS[stage.step.status]}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
