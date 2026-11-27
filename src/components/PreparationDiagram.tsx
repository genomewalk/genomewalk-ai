import type { ReactNode } from 'react';
import type { Journey, JourneyStep } from '../lib/session-types.ts';
import type { GenomeSource } from '../lib/types.ts';
import type { PreparationIconName } from './PreparationIcons.tsx';
import type { Tone } from './DiagramParts.tsx';
import { useId } from 'react';
import { EMBEDDING_MODEL } from '../config/embeddings.ts';
import iconLicense from '../assets/lucide-license.txt?raw';
import { PreparationIcon as Icon } from './PreparationIcons.tsx';
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

const count = (value: number | null | undefined) => (value == null ? '—' : value.toLocaleString());
const labels = ['Catalog', 'Match', 'Search index'];
const grey = '#9CA3AF';
const HEIGHT = 888;
// Vertical positions of the three step cards; the gaps hold the side inputs.
const cardY = [252, 460, 668] as const;

function Label({
  x,
  y,
  title,
  note,
  size = 14,
}: {
  x: number;
  y: number;
  title: ReactNode;
  note: string;
  size?: number;
}) {
  return (
    <>
      <text x={x} y={y} fontSize={size} fontWeight="700" fill={ink}>
        {title}
      </text>
      <text x={x} y={y + (size > 14 ? 17 : 16)} fontSize="11.5" fill={muted}>
        {note}
      </text>
    </>
  );
}
function Source({
  x,
  y,
  width,
  height,
  icon,
  title,
  note,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  icon: PreparationIconName;
  title: string;
  note: string;
}) {
  return (
    <>
      <rect x={x} y={y} width={width} height={height} rx="10" fill="#FFF" stroke={line} />
      <Icon name={icon} x={x + 12} y={y + height / 2 - 11} size={22} color={muted} />
      <Label x={x + 44} y={y + height / 2 - 3} title={title} note={note} />
    </>
  );
}
// A side input that joins the flow just above a step card.
function Input({
  y,
  icon,
  tone,
  title,
  note,
  download = false,
  marker,
  faded,
}: {
  y: number;
  icon: PreparationIconName;
  tone: Tone;
  title: string;
  note: string;
  download?: boolean;
  marker: string;
  faded: boolean;
}) {
  return (
    <g opacity={faded ? 0.45 : 1}>
      <rect
        x="150"
        y={y}
        width="330"
        height="40"
        rx="20"
        fill={tone.tint}
        stroke={tone.soft}
        strokeDasharray={download ? '5 4' : undefined}
      />
      <Icon name={icon} x={164} y={y + 10} size={20} color={tone.main} />
      <Label x={194} y={y + 17} title={title} note={note} size={13} />
      <path
        d={`M300 ${y + 43}V${y + 61}`}
        stroke={download ? tone.main : grey}
        strokeWidth="2"
        markerEnd={`url(#${marker}-${download ? 'download' : 'flow'})`}
      />
    </g>
  );
}
function Metric({
  x,
  value,
  label,
  small = false,
}: {
  x: number;
  value: string;
  label: string;
  small?: boolean;
}) {
  return (
    <>
      <text x={x} y="101" fontSize={small ? 13 : 20} fontWeight="700" fill={ink}>
        {value}
      </text>
      <text x={x} y="118" fontSize="12" fill={muted}>
        {label}
      </text>
    </>
  );
}

export function PreparationDiagram({
  journey,
  selected,
  genome,
}: {
  journey: Journey;
  selected: number;
  genome: GenomeSource;
}) {
  const id = useId();
  const [catalog, matching, index] = journey.steps as [
    JourneyStep,
    JourneyStep,
    JourneyStep,
    ...JourneyStep[],
  ];
  const reference = catalog.data;
  const counts = matching.data?.counts;
  const total = count(reference?.total);
  const build = reference?.source?.build ?? genome?.build ?? '—';
  const modelName = (index.data?.model?.id ?? EMBEDDING_MODEL.id).split('/').at(-1)!;
  const example = genome?.kind === 'example';
  const state = (step: number) =>
    step === selected ? 'current' : step < selected ? 'past' : 'later';
  const arrowX = CARD.x + 58;
  const descriptions = [
    'The app uses the same prepared public reference as Genomewalk. It combines ClinVar’s variant classifications, condition names, review information and publication links with available gnomAD population frequencies. The reference is chosen for your genome build and downloaded to your browser. This step does not send your genome to ClinVar or gnomAD.',
    'The selected genome is compared with the reference inside your browser. We check that the genome location and allele agree, then keep records that pass the matching checks. The usable matches become the pool for later questions. Calls left out of that pool are marked with an asterisk and explained below; each answer uses a small selection of relevant matches.',
    `The app uses ${modelName}, a small embedding model, to turn each matched record’s description into a numerical representation of its meaning. Your questions use the same model to find related records even when the wording differs. The model runs locally through Transformers.js, and the records and embeddings stay in your browser. This prepares search; a separate chat model writes the answers.`,
  ];
  return (
    <>
      <p className="preparation-description">{descriptions[selected]}</p>
      <figure className="step-diagram" tabIndex={0} aria-label="Preparation flow diagram">
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
            From a genome file to private search — step {selected + 1} of 3: {labels[selected]}
          </title>
          <desc id={`${id}-description`}>
            ClinVar annotations and gnomAD population frequencies are prepared into hosted public
            reference files. Your browser loads {total} reference variants for {build}. The selected
            genome is matched locally: {count(counts?.matched)} usable matches and{' '}
            {count(counts?.needsReview)} calls left out. Calls that fail matching checks stay out of
            search. {modelName} runs locally to build the search index:{' '}
            {count(index.data?.count ?? index.data?.counts?.matched)} searchable records. Public
            model files download from Hugging Face; genome data stays in the browser.
          </desc>
          <metadata>{iconLicense}</metadata>
          <defs>
            <ArrowMarker id={`${id}-flow`} color={grey} />
            <ArrowMarker id={`${id}-download`} color={tones.blue.main} />
          </defs>

          <rect x="8.5" y="16.5" width="483" height="156" rx="16" fill="#F5F6F8" stroke={line} />
          <text x="26" y="40" fontSize="11" fontWeight="700" fill={muted} letterSpacing="1.4">
            PUBLIC RESOURCES
          </text>
          <Source
            x={26}
            y={52}
            width={186}
            height={48}
            icon="database"
            title="ClinVar"
            note="Variant annotations"
          />
          <Source
            x={26}
            y={108}
            width={186}
            height={48}
            icon="database"
            title="gnomAD"
            note="Population frequencies"
          />
          <path d="M212 76H232V132H212" fill="none" stroke={grey} strokeWidth="2" />
          <path d="M232 104H260" stroke={grey} strokeWidth="2" markerEnd={`url(#${id}-flow)`} />
          <Source
            x={264}
            y={70}
            width={210}
            height={68}
            icon="server"
            title="Reference hosting"
            note="Prepared public files"
          />

          <rect x="8.5" y="196.5" width="483" height="620" rx="16" fill="#FAFBFC" stroke={line} />
          <Icon name="panels-top-left" x={24} y={211} size={22} color={muted} />
          <text x="56" y="228" fontSize="16" fontWeight="700" fill={ink}>
            Your browser
          </text>
          <Icon
            name="shield-check"
            x={DIAGRAM_WIDTH - 180}
            y={214}
            size={16}
            color={tones.green.main}
          />
          <text x={DIAGRAM_WIDTH - 24} y="227" textAnchor="end" fontSize="12" fill={muted}>
            Genome data stays here
          </text>
          <path
            d={`M290 141V${cardY[0] - 3}`}
            stroke={tones.blue.main}
            strokeWidth="2"
            strokeDasharray="5 4"
            markerEnd={`url(#${id}-download)`}
          />

          <StepCard
            y={cardY[0]}
            number={1}
            title="Load the catalog"
            illustration="catalog"
            tone={tones.blue}
            state={state(0)}
            status={catalog.status}
            description={['ClinVar + gnomAD reference', 'for this genome build.']}
          >
            <Metric x={120} value={total} label="reference variants" />
            <Metric x={300} value={build} label="genome build" />
          </StepCard>

          {[1, 2].map((step) => (
            <path
              key={step}
              d={`M${arrowX} ${cardY[step - 1]! + CARD.height + 3}V${cardY[step]! - 3}`}
              stroke={grey}
              strokeWidth="2"
              markerEnd={`url(#${id}-flow)`}
              opacity={selected < step ? 0.45 : 1}
            />
          ))}
          <Input
            y={396}
            icon="dna"
            tone={tones.coral}
            title="Selected genome file"
            note={example ? 'GIAB HG002 · public example' : 'Your file · read in this browser'}
            marker={id}
            faded={selected < 1}
          />
          <StepCard
            y={cardY[1]}
            number={2}
            title="Match locally"
            illustration="match"
            tone={tones.coral}
            state={state(1)}
            status={matching.status}
            description={['Compare location and allele;', 'check the file and genotypes.']}
          >
            <Metric x={120} value={count(counts?.matched)} label="usable matches" />
            <Metric x={300} value={count(counts?.needsReview)} label="calls left out*" />
          </StepCard>

          <Input
            y={604}
            icon="cloud-download"
            tone={tones.blue}
            title="Embedding model files"
            note="Downloaded from Hugging Face when needed"
            download
            marker={id}
            faded={selected < 2}
          />
          <StepCard
            y={cardY[2]}
            number={3}
            title="Build the index"
            illustration="index"
            tone={tones.violet}
            state={state(2)}
            status={index.status}
            description={['A small local model embeds each', 'record so questions can find it.']}
          >
            <Metric
              x={120}
              value={count(index.data?.count ?? index.data?.counts?.matched)}
              label="searchable records"
            />
            <Metric x={280} value={modelName} label="search model" small />
          </StepCard>

          <text x="12" y="840" fontSize="12" fill={muted}>
            * Calls that fail matching checks stay out of search.
          </text>
          <text x="12" y="858" fontSize="12" fill={muted}>
            Saved matches and the prepared index can be reused.
          </text>
          <text x="12" y="876" fontSize="12" fill={muted}>
            Dashed: public downloads · Solid: data flow
          </text>
          <text x={DIAGRAM_WIDTH - 12} y="876" fontSize="11" fill={muted} textAnchor="end">
            Icons: Lucide · ISC / MIT
          </text>
        </svg>
      </figure>
    </>
  );
}
