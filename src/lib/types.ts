import type { ChatCompletionRequestStreaming, ChatCompletionChunk } from '@mlc-ai/web-llm';
import type { VariantIdentity } from '../vendor/genomewalk/catalogues/types.ts';

export interface CatalogRow extends VariantIdentity {
  citation: string;
  rowNumber?: number;
  build?: string;
  sig?: string;
  stars?: number | null;
  gene?: string;
  rsids?: string;
  hgvs?: string;
  variationid?: string;
  alleleid?: string;
  classification?: string;
  conflictingclassifications?: string;
  conditions?: string;
  conditionmedgenids?: string;
  reviewstatus?: string;
  af?: number | string | null;
  afmax?: number | string | null;
  an?: number | string | null;
  gnomadac?: number | string | null;
  grp?: string;
  gnomadkey?: string;
  gnomadfilter?: string;
  gnomaddiscordancep?: number | string | null;
  pmids?: string;
  releasedate?: string;
  citationdate?: string;
}
export interface GenomeCall {
  gt: string;
  alleles: string[];
  copies: number | null;
  ploidy?: number | null;
  filter?: string | null;
  sampleFilter?: string | null;
  dp?: number | null;
  gq?: number | null;
  qual?: number | null;
  alleleDepths?: { alleles: string[]; readCounts: (number | null)[] } | null;
  line?: number;
  format?: string;
  provider?: string;
  sourceVcfFields?: {
    chrom: string;
    pos: number;
    id: string;
    ref: string;
    alt: string;
    qual: string;
    filter: string;
    format: string;
    sampleValues: string;
  } | null;
}
export interface MatchedRow extends CatalogRow {
  call: GenomeCall;
  recordCount?: number;
}
export interface ExcludedRow extends CatalogRow {
  call?: GenomeCall;
  recordCount?: number;
  reasons: string[];
  observations: (GenomeCall | { format: string; fields: string[] })[];
}
export interface MatchStats {
  records: number;
  matched: number;
  needsReview: number;
  candidateRecords?: number;
  explicitlyNotCarried?: number;
  notObserved?: number;
  rsidLocationMismatches?: number;
}
export interface MatchResult {
  build: string;
  matches: MatchedRow[];
  issues: ExcludedRow[];
  stats: MatchStats;
  limitations: string;
}
export interface GenomeSource {
  kind: 'example' | 'upload';
  available: boolean;
  name: string;
  label: string;
  bytes: number;
  format?: 'consumer' | 'vcf';
  build?: string;
  provider?: string;
  strand?: string;
  buildSource?: string;
  strandSource?: string;
  sha256?: string;
  cacheKey?: string;
  source?: string;
  scope?: string;
}
export interface CatalogSource {
  build: string;
  sha256: string;
}
export interface CatalogConfig extends CatalogSource {
  phase: string;
  rows: number;
  cacheKey: string;
  lookupRevision?: string;
  message?: string;
}
export interface GenomeConfig {
  catalog: CatalogConfig;
  localGenome: GenomeSource;
}
export interface MatchProgress {
  bytes: number;
  records: number;
}
export interface ProgressOptions {
  signal?: AbortSignal;
  onProgress?: (progress: MatchProgress) => void;
}
export interface TextProgressOptions {
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}
export interface ModelProfile {
  note?: string;
  id: string;
  modelId: string;
  label: string;
  shortLabel: string;
  nativeContextWindowTokens?: number;
  contextWindowTokens: number;
  generation: Generation;
  extraBody?: ChatCompletionRequestStreaming['extra_body'];
}
export type Generation = Partial<Omit<ChatCompletionRequestStreaming, 'messages' | 'stream'>>;
export type ModelRequest = Omit<ChatCompletionRequestStreaming, 'messages'> & {
  messages: ModelMessage[];
};
export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
export interface ModelChunk {
  choices: {
    delta: { content?: string | null };
    finish_reason?: ChatCompletionChunk['choices'][number]['finish_reason'];
  }[];
  usage?: ChatCompletionChunk['usage'];
}
export interface ModelEngine {
  complete(request: ModelRequest): AsyncIterable<ModelChunk>;
  reset(): Promise<void>;
  interrupt(): void;
  unload(): Promise<void>;
  dispose(): void;
}
export interface EngineOptions {
  profile: ModelProfile;
  onProgress(progress: { progress: number; text: string }): void;
  onFatal(error: Error): void;
}
export interface ModelLease {
  model: ModelProfile;
  epoch: number;
}
export interface CompletionOptions {
  signal?: AbortSignal;
  lease?: ModelLease;
  generation?: Generation;
  onRequest?: (request: ModelRequest) => void;
}
export interface SearchPlan {
  mode: 'search' | 'overview' | 'other';
  query: string;
}
export interface SourceLink {
  label: string;
  url: string;
}
export interface RecordField {
  label: string;
  text?: string | null;
  items?: (string | null)[];
  sources: SourceLink[];
}
export interface ReferenceRecord {
  id: string;
  origin: string;
  gene: string | null;
  variant: string;
  conditionClassifications: null;
  fields: RecordField[];
}
export interface GenomeProvenance {
  kind: 'example' | 'upload';
  label: string;
}
export interface RecordReference {
  maxSelectedRecords: number;
  genomeSource?: GenomeProvenance | null;
  records: ReferenceRecord[];
}
export interface RecordSelection {
  selected: string[];
}
export interface Weights {
  classification: number;
  review: number;
}
export interface SemanticHit {
  index: number;
  similarity: number;
}
export interface IndexResult {
  count: number;
  dimensions: number;
}
export interface SearchOperations {
  index: { input: { documents: string[] }; output: IndexResult };
  score: { input: { query: string }; output: SemanticHit[] };
}
export interface SearchClient {
  hasIndex: boolean;
  call<K extends keyof SearchOperations>(
    operation: K,
    payload: SearchOperations[K]['input'],
    options?: TextProgressOptions,
  ): Promise<SearchOperations[K]['output']>;
  dispose(error?: Error): void;
}
