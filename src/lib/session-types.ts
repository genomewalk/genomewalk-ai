import type {
  CatalogSource,
  GenomeSource,
  GenomeConfig,
  MatchResult,
  ModelProfile,
  ModelChunk,
  ModelRequest,
  ModelMessage,
  Generation,
  SearchPlan,
  RecordSelection,
  GenomeProvenance,
  Weights,
} from './types.ts';
import type { compactMatch } from './match-reference.ts';
import type { catalogPriority } from './evidence-ranking.ts';
import type { buildEmbeddingsContext } from './embeddings-context.ts';
import type { buildGeneralContext } from './general-context.ts';
import type { CacheInfo } from './match-cache.ts';

export type StepStatus =
  'pending' | 'running' | 'complete' | 'skipped' | 'error' | 'stopped' | 'limited' | 'paused';
export type StepId = 'catalog' | 'matching' | 'index' | 'query' | 'semantic' | 'context' | 'answer';
export interface RankedHit {
  index: number;
  rank: number;
  priority: ReturnType<typeof catalogPriority>;
  similarity?: number;
  score?: number;
  classValue?: number;
  reviewValue?: number;
  classificationContribution?: number;
  reviewContribution?: number;
}
export interface RankedRecord extends RankedHit {
  record: ReturnType<typeof compactMatch>;
  searchText: string;
}
export type EvidenceContext = Omit<ReturnType<typeof buildEmbeddingsContext>, 'messages'>;
export type GeneralContext = Omit<ReturnType<typeof buildGeneralContext>, 'messages'>;
// Context metadata is shared by both answer paths; record fields exist only after retrieval.
export type AnswerContext = Omit<GeneralContext, 'generation'> & {
  generation: Generation;
} & Partial<Omit<EvidenceContext, keyof GeneralContext>>;
export interface StepData extends Partial<AnswerContext> {
  source?: CatalogSource;
  total?: number;
  catalogRecords?: number;
  reused?: boolean;
  storage?: string;
  savedAt?: number;
  sentRemotely?: boolean;
  counts?: MatchResult['stats'];
  limitations?: string;
  cache?: CacheInfo;
  model?: { id: string; revision: string; dtype: string; device: string };
  count?: number;
  dimensions?: number;
  documentTokenLimit?: number;
  note?: string;
  request?: ModelRequest;
  response?: SearchPlan;
  decisionSource?: string;
  mode?: SearchPlan['mode'];
  query?: string;
  weights?: Weights;
  formula?: string;
  rows?: RankedRecord[];
  scores?: RankedHit[];
  previewLimit?: number;
  messages?: ModelMessage[];
  raw?: string;
  selection?: RecordSelection;
  rendered?: string;
  finishReason?: ModelChunk['choices'][number]['finish_reason'];
  usage?: ModelChunk['usage'];
  opening?: StepData;
}
export interface JourneyStep {
  id: StepId;
  label: string;
  location: string;
  status: StepStatus;
  summary?: string;
  startedAt?: number;
  endedAt?: number;
  data?: StepData;
}
export interface Journey {
  startedAt: number;
  endedAt?: number;
  localOnly: boolean;
  status?: StepStatus;
  steps: JourneyStep[];
}
export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  question?: string;
  status?: 'streaming' | 'complete' | 'stopped' | 'error';
  model?: ModelProfile;
  genomeSource?: GenomeProvenance | null;
  journey?: Journey;
  result?: MatchResult;
  context?: AnswerContext;
  stage?: string;
  general?: boolean;
  answerSelection?: RecordSelection;
  evidenceAnswer?: boolean;
  limited?: boolean;
  finishReason?: ModelChunk['choices'][number]['finish_reason'];
  usage?: ModelChunk['usage'];
}
export interface PreparedIndex {
  identity: string;
  source: CatalogSource;
  total: number;
  result: MatchResult;
  documents: string[];
}
export interface EmbeddingsState {
  weights: Weights;
  phase: 'idle' | 'checking' | 'ready' | 'stopped' | 'error';
  busy: boolean;
  activity: 'preparing' | 'answering' | null;
  switching: boolean;
  stopping: boolean;
  genome: GenomeSource;
  preparationJourney: Journey;
  config: GenomeConfig | null;
  messages: ChatMessage[];
  error: { message: string } | null;
  progressText: string;
  indexReady: boolean;
  matchCount: number;
  excludedCount: number;
  matchCacheInfo: CacheInfo | null;
}
