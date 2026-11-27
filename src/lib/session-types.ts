import type {
  CatalogSource,
  GenomeSource,
  GenomeConfig,
  MatchResult,
  ModelProfile,
  ModelChunk,
  ModelRequest,
  ModelMessage,
  SearchPlan,
} from './types.ts';
import type { compactMatch } from './match-reference.ts';
import type { catalogPriority } from './evidence-ranking.ts';
import type { buildEmbeddingsContext } from './embeddings-context.ts';
import type { CacheInfo } from './match-cache.ts';

export type StepStatus = 'pending' | 'running' | 'complete' | 'skipped' | 'error' | 'stopped';
export type StepId = 'catalog' | 'matching' | 'index' | 'query' | 'semantic' | 'context' | 'answer';
export interface RankedHit {
  index: number;
  rank: number;
  priority: ReturnType<typeof catalogPriority>;
  similarity?: number;
}
export interface RankedRecord extends RankedHit {
  record: ReturnType<typeof compactMatch>;
  searchText: string;
}
export type AnswerContext = Omit<ReturnType<typeof buildEmbeddingsContext>, 'messages'>;
export interface StepData extends Partial<AnswerContext> {
  source?: CatalogSource;
  total?: number;
  counts?: MatchResult['stats'];
  model?: { id: string; revision: string; dtype: string; device: string };
  count?: number;
  dimensions?: number;
  request?: ModelRequest;
  response?: SearchPlan;
  catalogSummary?: string;
  query?: string;
  rows?: RankedRecord[];
  scores?: RankedHit[];
  messages?: ModelMessage[];
  raw?: string;
  finishReason?: ModelChunk['choices'][number]['finish_reason'];
  usage?: ModelChunk['usage'];
}
export interface JourneyStep {
  id: StepId;
  label: string;
  status: StepStatus;
  summary?: string;
  startedAt?: number;
  endedAt?: number;
  data?: StepData;
}
export interface Journey {
  startedAt: number;
  endedAt?: number;
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
  journey?: Journey;
  result?: MatchResult;
  context?: AnswerContext;
  evidenceAnswer?: boolean;
  finishReason?: ModelChunk['choices'][number]['finish_reason'];
  usage?: ModelChunk['usage'];
}
export interface PreparedIndex {
  identity: string;
  source: CatalogSource;
  total: number;
  result: MatchResult;
  documents: string[];
  summary: string;
}
export interface EmbeddingsState {
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
