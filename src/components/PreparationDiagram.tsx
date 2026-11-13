import type { SVGProps, ReactNode } from 'react';
import type { Journey, JourneyStep } from '../lib/session-types.ts';
import type { GenomeSource } from '../lib/types.ts';
import { useId } from 'react';
import { EMBEDDING_MODEL } from '../config/embeddings.ts';
import iconLicense from '../assets/lucide-license.txt?raw';
import { PreparationIcon as Icon } from './PreparationIcons.tsx';

const count = (value: number | null | undefined) => (value == null ? '—' : value.toLocaleString());
const labels = ['Catalog', 'Match', 'Search index'];
const ink = '#244C40',
  muted = '#64756C',
  green = '#587D53',
  blue = '#728B97';

function Text({
  x,
  y,
  children,
  size = 16,
  weight = 400,
  color = ink,
  ...props
}: Omit<SVGProps<SVGTextElement>, 'color'> & {
  x: number;
  y: number;
  children: ReactNode;
  size?: number;
  weight?: number;
  color?: string;
}) {
  return (
    <text x={x} y={y} fontSize={size} fontWeight={weight} fill={color} {...props}>
      {children}
    </text>
  );
}
function Lines({
  x,
  y,
  rows,
  size = 16,
  dy = 25,
}: {
  x: number;
  y: number;
  rows: string[];
  size?: number;
  dy?: number;
}) {
  return rows.map((line, i) => (
    <Text key={i} x={x} y={y + i * dy} size={size} color={muted}>
      {line}
    </Text>
  ));
}
function Box({
  x,
  y,
  w,
  h,
  fill = '#FFFEFA',
  stroke = '#D3DBCD',
  r = 14,
  ...props
}: SVGProps<SVGRectElement> & { x: number; y: number; w: number; h: number; r?: number }) {
  return <rect x={x} y={y} width={w} height={h} rx={r} fill={fill} stroke={stroke} {...props} />;
}
function Flow({
  d,
  id,
  download = false,
  arrow = true,
  color,
}: {
  d: string;
  id?: string;
  download?: boolean;
  arrow?: boolean;
  color?: string;
}) {
  return (
    <path
      d={d}
      fill="none"
      stroke={color || (download ? blue : green)}
      strokeWidth="2"
      strokeLinejoin="round"
      strokeLinecap="round"
      strokeDasharray={download ? '6 5' : undefined}
      markerEnd={arrow ? `url(#${id}-${download ? 'download' : 'flow'})` : undefined}
    />
  );
}
function Stage({
  x,
  number,
  title,
  selected,
  children,
}: {
  x: number;
  number: number;
  title: string;
  selected: number;
  children: ReactNode;
}) {
  const current = selected === number - 1;
  return (
    <g data-preparation-stage={number}>
      <Box
        x={x}
        y={570}
        w={350}
        h={230}
        fill={current ? '#EDF3E5' : undefined}
        stroke={current ? green : undefined}
        strokeWidth={current ? 2 : 1}
      />
      <circle cx={x + 37} cy="607" r="18" fill={current ? green : '#E7EFDC'} />
      <Text
        x={x + 37}
        y={613}
        size={17}
        weight={600}
        color={current ? '#FFFFFF' : ink}
        textAnchor="middle"
      >
        {number}
      </Text>
      <Text x={x + 69} y={614} size={23} weight={600}>
        {title}
      </Text>
      {children}
    </g>
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
  const total = count(reference?.total ?? reference?.catalogRecords);
  const build = reference?.source?.build ?? genome?.build ?? '—';
  const modelName = (index.data?.model?.id ?? EMBEDDING_MODEL.id).split('/').at(-1)!;
  const example = genome?.kind === 'example';
  // Fit the stages currently shown instead of reserving space for future nodes.
  const diagramWidth = [800, 940, 1360][selected]!;
  const catalogShift = selected === 0 ? 147 : 0;
  const privacyX = selected === 2 ? 786 : diagramWidth - 330;
  const descriptions = [
    'The app uses the same prepared public reference as Genomewalk. It combines ClinVar’s variant classifications, condition names, review information and publication links with available gnomAD population frequencies. The reference is chosen for your genome build and downloaded to your browser. This step does not send your genome to ClinVar or gnomAD.',
    'The selected genome is compared with the reference inside your browser. We check that the genome location and allele agree, then keep records that pass the matching checks. The usable matches become the pool for later questions. Calls left out of that pool are marked with an asterisk and explained below; each answer uses a small selection of relevant matches.',
    `The app uses ${modelName}, a small embedding model, to turn each matched record’s description into a numerical representation of its meaning. Your questions use the same model to find related records even when the wording differs. The model runs locally through Transformers.js, and the records and embeddings stay in your browser. This prepares search; a separate chat model writes the answers.`,
  ];
  return (
    <>
      <p className="preparation-description">{descriptions[selected]}</p>
      <figure className="preparation-diagram">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width={diagramWidth}
          height="946"
          viewBox={`0 128 ${diagramWidth} 946`}
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
            reference files. Your browser loads {total} reference variants for {build}.
            {selected > 0 &&
              ` The selected genome is matched locally: ${count(counts?.matched)} usable matches and ${count(counts?.needsReview)} calls left out. Calls that fail matching checks stay out of search.`}
            {selected > 1 &&
              ` ${modelName} runs locally to build the search index: ${count(index.data?.count ?? index.data?.counts?.matched)} searchable records. Public model files download from Hugging Face; genome data stays in the browser.`}
          </desc>
          <metadata>{iconLicense}</metadata>
          <defs>
            {[
              ['flow', green],
              ['download', blue],
            ].map(([name, color]) => (
              <marker
                key={name}
                id={`${id}-${name}`}
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
            ))}
          </defs>
          <Box x={0} y={0} w={diagramWidth} h={1074} fill="#FBFAF6" stroke="#FBFAF6" r={0} />

          <Box
            x={44}
            y={144}
            w={diagramWidth - 88}
            h={216}
            fill="#F0F2ED"
            stroke="#DDE2D7"
            r={18}
          />
          <Text x={66} y={170} size={12} weight={600} color={muted} letterSpacing="1.6">
            PUBLIC RESOURCES
          </Text>
          <Box x={78} y={186} w={240} h={66} />
          <Icon name="database" x={94} y={204} size={30} />
          <Text x={137} y={213} size={18} weight={600}>
            ClinVar
          </Text>
          <Text x={137} y={235} size={14} color={muted}>
            Variant annotations
          </Text>
          <Box x={78} y={274} w={240} h={66} />
          <Icon name="database" x={94} y={292} size={30} />
          <Text x={137} y={301} size={18} weight={600}>
            gnomAD
          </Text>
          <Text x={137} y={323} size={14} color={muted}>
            Population frequencies
          </Text>
          <Flow d="M318 219H350V307H318" arrow={false} color="#A5B39D" />
          <Flow id={id} d="M350 263H430" />
          <Text x={386} y={245} size={12} color={muted} textAnchor="middle">
            Prepare
          </Text>
          <Box x={432} y={213} w={300} h={100} />
          <Icon name="server" x={450} y={233} size={38} />
          <Text x={504} y={243} size={20} weight={600}>
            Reference hosting
          </Text>
          <Text x={504} y={267} size={15} color={muted}>
            Prepared public files
          </Text>
          <Text x={504} y={290} size={13} color={muted}>
            Static hosting / CDN
          </Text>

          <Box
            x={44}
            y={402}
            w={diagramWidth - 88}
            h={580}
            fill="#F2F6EC"
            stroke="#AFBFA3"
            r={18}
          />
          <Icon name="panels-top-left" x={66} y={418} size={31} />
          <Text x={112} y={441} size={22} weight={600}>
            Your browser
          </Text>
          <Icon name="shield-check" x={privacyX} y={421} size={22} />
          <Text x={privacyX + 33} y={439} size={15} weight={600}>
            Genome data stays here
          </Text>
          <path d={`M44 455H${diagramWidth - 44}`} stroke="#D4DFCB" />
          <Flow id={id} d={`M582 313V382H360V480H${253 + catalogShift}V568`} download />

          <g transform={`translate(${catalogShift} 0)`}>
            <Stage x={78} number={1} title="Load the catalog" selected={selected}>
              <Icon name="database" x={100} y={645} size={38} />
              <Lines
                x={155}
                y={658}
                rows={['ClinVar + gnomAD', 'Reference for this genome build']}
                size={15}
                dy={23}
              />
              <Text x={100} y={749} size={31} weight={600}>
                {total}
              </Text>
              <Text x={100} y={778} size={14} color={muted}>
                reference variants
              </Text>
              <Text x={286} y={749} size={24} weight={600}>
                {build}
              </Text>
              <Text x={286} y={778} size={14} color={muted}>
                genome build
              </Text>
            </Stage>
            <Lines
              x={78}
              y={835}
              rows={['Load the prepared reference for', 'the selected genome build.']}
            />
          </g>

          {selected > 0 && (
            <g>
              <Box x={535} y={470} w={290} h={72} fill="#FBF2E9" stroke="#E2C9B7" r={12} />
              <Icon name="dna" x={552} y={487} size={36} color="#A15D42" />
              <Text x={603} y={498} size={18} weight={600}>
                Selected genome file
              </Text>
              <Text x={603} y={521} size={12} color={muted}>
                {example ? 'GIAB HG002 · public example' : 'Your file · read in this browser'}
              </Text>
              <Flow id={id} d="M680 542V568" />
              <Flow id={id} d="M428 685H503" />
              <Stage x={505} number={2} title="Match locally" selected={selected}>
                <Icon name="shield-check" x={527} y={645} size={38} />
                <Lines
                  x={582}
                  y={658}
                  rows={['Location + allele comparison', 'File and genotype checks']}
                  size={15}
                  dy={23}
                />
                <Text x={527} y={749} size={31} weight={600}>
                  {count(counts?.matched)}
                </Text>
                <Text x={527} y={778} size={14} color={muted}>
                  usable matches
                </Text>
                <Text x={713} y={749} size={31} weight={600}>
                  {count(counts?.needsReview)}
                </Text>
                <Text x={713} y={778} size={14} color={muted}>
                  calls left out*
                </Text>
              </Stage>
              <Lines
                x={505}
                y={835}
                rows={[
                  'Keep usable allele matches.',
                  '* Calls that fail matching checks',
                  'stay out of search.',
                ]}
              />
            </g>
          )}

          {selected > 1 && (
            <g>
              <Box x={932} y={213} w={350} h={100} />
              <Icon name="cloud-download" x={950} y={234} size={38} color={blue} />
              <Text x={1004} y={243} size={20} weight={600}>
                Model hosting
              </Text>
              <Text x={1004} y={267} size={15} color={muted}>
                Hugging Face
              </Text>
              <Text x={1004} y={290} size={13} color={muted}>
                Public embedding-model files
              </Text>
              <Flow id={id} d="M1107 313V568" download />
              <Text x={1122} y={499} size={14} color={blue}>
                Download model
              </Text>
              <Text x={1122} y={519} size={14} color={blue}>
                when needed
              </Text>
              <Flow id={id} d="M855 685H930" />
              <Stage x={932} number={3} title="Build the index" selected={selected}>
                <Icon name="cpu" x={954} y={645} size={38} />
                <Lines
                  x={1009}
                  y={658}
                  rows={[modelName, 'Local embedding model']}
                  size={15}
                  dy={23}
                />
                <Icon name="search" x={956} y={729} size={28} />
                <Text x={999} y={750} size={31} weight={600}>
                  {count(index.data?.count ?? index.data?.counts?.matched)}
                </Text>
                <Text x={999} y={778} size={14} color={muted}>
                  searchable records
                </Text>
              </Stage>
              <Lines
                x={932}
                y={835}
                rows={[
                  'Turns descriptions into embeddings.',
                  'The same model encodes questions',
                  'to find related records by meaning.',
                  'Runs locally through Transformers.js.',
                ]}
              />
              {index.status === 'complete' && (
                <Text x={932} y={959} size={15} weight={600}>
                  Ready for private questions →
                </Text>
              )}
            </g>
          )}

          <Text x={78} y={959} size={14} color={muted}>
            Saved matches and the prepared index can be reused.
          </Text>
          <Text x={48} y={1016} size={14} color={muted}>
            {example ? 'Example: public GIAB HG002' : 'Selected genome'} · {build}. Counts reflect
            the selected genome and catalog.
          </Text>
          <Text x={48} y={1043} size={13} color={muted}>
            Dashed arrows: public downloads · Solid arrows: data flow
          </Text>
          <Text x={diagramWidth - 44} y={1043} size={12} color={muted} textAnchor="end">
            Icons: Lucide · ISC / MIT
          </Text>
        </svg>
      </figure>
    </>
  );
}
