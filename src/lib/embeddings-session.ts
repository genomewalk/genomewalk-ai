import type {
  GenomeSource,
  GenomeConfig,
  Weights,
  SearchClient,
  ModelLease,
  SearchPlan,
  ModelRequest,
} from './types.ts';
import type {
  EmbeddingsState,
  ChatMessage,
  JourneyStep,
  StepStatus,
  PreparedIndex,
} from './session-types.ts';
import type { ConversationTurn } from './conversation-context.ts';
import type { Fetcher } from '../vendor/genomewalk/io/types.ts';
import type { LocalModelSession } from './local-model-session.ts';

interface SessionOptions {
  fetchImpl?: Fetcher;
  local?: Pick<LocalModelSession, 'state' | 'reserve' | 'release' | 'completePrivate'>;
  matcher?: typeof matchLocalGenome;
  identify?: typeof identifyLocalGenome;
  genomeSource?: GenomeSource;
  search?: SearchClient;
  matchCache?: MatchCache;
}
import { localModelSession } from './local-model-session.ts';
import { EmbeddingsClient } from './embeddings-client.ts';
import { matchLocalGenome, identifyLocalGenome } from './genome-client.ts';
import { chooseGenomeFile } from './genome-source.ts';
import { EXAMPLE_GENOME } from '../config/example-genome.ts';
import { genomeProvenance } from './genome-provenance.ts';
import { loadCatalogKeys, hydrateGenomewalkMatches } from './local-catalog.ts';
import { searchDocument } from './semantic-search.ts';
import { buildEmbeddingsContext } from './embeddings-context.ts';
import { compactMatch } from './match-reference.ts';
import { rankCombined, rankCatalogOverview } from './evidence-ranking.ts';
import { createEmbeddingsJourney, updateJourney, finishJourney } from './request-journey.ts';
import { EMBEDDING_MODEL, RETRIEVAL } from '../config/embeddings.ts';
import { PLAN_LABELS } from '../config/search-scope.ts';
import { parseLocalQuery, buildLocalQueryContext } from './local-query.ts';
import {
  DEFAULT_WEIGHTS,
  FORMULA,
  PREVIEW_LIMIT,
  validateWeights,
} from '../config/evidence-ranking.ts';
import { MatchCache, matchCacheIdentity } from './match-cache.ts';
import {
  parseRecordSelection,
  renderRecordSelection,
  buildEvidenceOpeningContext,
} from './evidence-answer.ts';
import { buildGeneralContext } from './general-context.ts';
import { loadReferenceConfig } from './public-files.ts';

const identity = (config: GenomeConfig) =>
  JSON.stringify([
    config.catalog.sha256,
    config.catalog.cacheKey,
    config.catalog.lookupRevision,
    config.localGenome,
  ]);

export class EmbeddingsSession {
  fetch: Fetcher;
  local: NonNullable<SessionOptions['local']>;
  matcher: typeof matchLocalGenome;
  search: SearchClient;
  matchCache: MatchCache;
  identify: typeof identifyLocalGenome;
  genome: GenomeSource;
  file: File | null;
  selection: number;
  initialized: boolean;
  disposed: boolean;
  listeners: Set<() => void>;
  nextId: number;
  history: ConversationTurn[];
  prepared: PreparedIndex | null;
  state: EmbeddingsState;
  controller: AbortController | null = null;
  preparation: Promise<void> | null = null;
  constructor({
    fetchImpl = (...args) => fetch(...args),
    local = localModelSession,
    matcher = matchLocalGenome,
    identify = identifyLocalGenome,
    genomeSource = EXAMPLE_GENOME,
    search = new EmbeddingsClient(),
    matchCache = new MatchCache(),
  }: SessionOptions = {}) {
    this.fetch = fetchImpl;
    this.local = local;
    this.matcher = matcher;
    this.search = search;
    this.matchCache = matchCache;
    this.identify = identify;
    this.genome = genomeSource;
    this.file = null;
    this.selection = 0;
    this.initialized = false;
    this.disposed = false;
    this.listeners = new Set();
    this.nextId = 0;
    this.history = [];
    this.prepared = null;
    this.state = {
      weights: { ...DEFAULT_WEIGHTS },
      phase: 'idle',
      busy: false,
      activity: null,
      switching: false,
      stopping: false,
      genome: genomeSource,
      preparationJourney: createEmbeddingsJourney(),
      config: null,
      messages: [],
      error: null,
      progressText: '',
      indexReady: false,
      matchCount: 0,
      excludedCount: 0,
      matchCacheInfo: null,
    };
  }
  setWeights(weights: Weights) {
    this.update({ weights: validateWeights(weights) });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  update(patch: Partial<EmbeddingsState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  updateMessage(id: number | null | undefined, patch: Partial<ChatMessage>) {
    this.update({
      messages: this.state.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    });
  }
  step(id: number | null | undefined, step: string, patch: Partial<JourneyStep>) {
    if (id == null) {
      this.update({
        preparationJourney: updateJourney(this.state.preparationJourney, step, patch),
      });
      return;
    }
    const m = this.state.messages.find((m) => m.id === id);
    this.updateMessage(id, { journey: updateJourney(m!.journey!, step, patch) });
  }
  async readConfig(signal?: AbortSignal) {
    const catalog = await loadReferenceConfig(this.genome.build, { signal, fetchImpl: this.fetch });
    return { catalog, localGenome: this.genome };
  }
  initialize() {
    // Explicit initialization is idempotent for programmatic callers.
    if (this.initialized) return this.preparation ?? Promise.resolve();
    this.initialized = true;
    return this.prepare();
  }
  async selectGenome(file: File | null = null) {
    if (this.disposed || this.state.activity === 'answering') return false;
    if (file) chooseGenomeFile([file]);
    const selection = ++this.selection;
    this.controller?.abort();
    this.update({ switching: true });
    await this.preparation;
    if (selection !== this.selection || this.disposed) return false;
    this.file = file;
    this.genome = file
      ? { kind: 'upload', available: false, name: file.name, label: file.name, bytes: file.size }
      : EXAMPLE_GENOME;
    this.history = [];
    this.prepared = null;
    this.search.dispose();
    this.update({
      genome: this.genome,
      switching: false,
      messages: [],
      config: null,
      error: null,
      indexReady: false,
      matchCount: 0,
      excludedCount: 0,
      matchCacheInfo: null,
    });
    await this.prepare();
    return selection === this.selection && !this.disposed;
  }
  async prepareIndex(signal?: AbortSignal, id?: number) {
    const config = await this.readConfig(signal);
    if (config.catalog.phase !== 'ready')
      throw new Error(config.catalog.message || 'The prepared Genomewalk catalog is unavailable.');
    if (!config.localGenome?.available)
      throw new Error('Choose a supported genome file or use the public example.');
    const key = identity(config);
    const priorEvidence = this.history.findLast((turn) => turn.records?.length);
    if (priorEvidence && priorEvidence.identity !== key)
      throw new Error(
        'The genome or catalog changed. Start a new conversation before combining evidence.',
      );
    this.update({ config });
    if (this.prepared?.identity === key) {
      for (const step of ['catalog', 'matching', 'index'])
        this.step(id, step, {
          status: 'complete',
          summary: `Reused the complete in-memory index · ${this.prepared.result.matches.length.toLocaleString()} matches`,
          data: {
            reused: true,
            catalogRecords: this.prepared.total,
            source: this.prepared.source,
            counts: this.prepared.result.stats,
          },
        });
      return this.prepared;
    }
    this.prepared = null;
    this.update({ indexReady: false });
    const report = (message: string) => {
      if (!signal?.aborted) this.update({ progressText: message });
    };
    const cacheIdentity = matchCacheIdentity(config);
    const cached = this.matchCache.read(cacheIdentity);
    this.update({ matchCacheInfo: cached.info });
    let source;
    let total;
    let result;
    if (cached.entry) {
      ({ source, total, result } = cached.entry);
      const matchCacheInfo = {
        ...cached.info,
        status: 'restored',
        message: `${result.matches.length.toLocaleString()} saved matches restored from this browser. Catalog download and genome scan skipped.`,
      };
      this.update({ matchCacheInfo });
      this.step(id, 'catalog', {
        status: 'complete',
        summary: 'Reference data reused from this browser',
        data: {
          source,
          total,
          reused: true,
          storage: 'localStorage',
          savedAt: cached.info.savedAt,
          sentRemotely: false,
        },
      });
      this.step(id, 'matching', {
        status: 'complete',
        summary: 'Saved matches reused · no new scan needed',
        data: {
          counts: result.stats,
          limitations: result.limitations,
          storage: 'localStorage',
          savedAt: cached.info.savedAt,
        },
      });
    } else {
      this.step(id, 'catalog', { status: 'running', summary: 'Loading the ClinVar reference…' });
      const loaded = await loadCatalogKeys(config, {
        signal,
        fetchImpl: this.fetch,
        onProgress: report,
      });
      signal?.throwIfAborted();
      ({ source, total } = loaded);
      this.step(id, 'catalog', {
        status: 'complete',
        summary: 'ClinVar reference ready',
        data: { source, total, sentRemotely: false },
      });
      this.step(id, 'matching', {
        status: 'running',
        summary: 'Comparing your genome with ClinVar…',
      });
      report(
        this.genome.kind === 'example'
          ? 'Loading the public GIAB example (42 MB on first use), then matching locally…'
          : 'Matching the full catalog against your selected file…',
      );
      result = await this.matcher({
        config,
        file: this.file,
        candidates: loaded.candidates,
        lookup: loaded.lookup,
        signal,
        onProgress: ({ bytes, records }) =>
          report(
            `Matching locally · ${Math.min(100, Math.round((100 * bytes) / config.localGenome.bytes))}% read · ${records.toLocaleString()} records`,
          ),
      });
      signal?.throwIfAborted();
      report('Reading matched annotations through Genomewalk’s verified catalog stream…');
      result = await hydrateGenomewalkMatches(result, loaded.catalogue, signal, (p) =>
        report(`Reading matched annotations · ${Math.round(p * 100)}%`),
      );
      signal?.throwIfAborted();
      // Publish only a complete verified result for files that stayed unchanged.
      const current = await this.readConfig(signal);
      signal?.throwIfAborted();
      if (identity(current) !== key)
        throw new Error(
          'The genome or catalog changed during matching. Refresh local files and prepare again.',
        );
      const matchCacheInfo = this.matchCache.write(cacheIdentity, { source, total, result });
      this.update({ matchCacheInfo });
      this.step(id, 'matching', {
        status: 'complete',
        summary: 'Genome comparison complete',
        data: { counts: result.stats, limitations: result.limitations, cache: matchCacheInfo },
      });
    }
    const documents = result.matches.map(searchDocument);
    this.updateMessage(id, { result });
    this.step(id, 'index', {
      status: 'running',
      summary: 'Loading the embedding model and indexing matched annotations locally…',
    });
    const index = await this.search.call('index', { documents }, { signal, onProgress: report });
    signal?.throwIfAborted();
    this.step(id, 'index', {
      status: 'complete',
      summary: `${index.count.toLocaleString()} embeddings · ${index.dimensions} dimensions · cached in memory`,
      data: {
        model: EMBEDDING_MODEL,
        ...index,
        documentTokenLimit: RETRIEVAL.documentTokens,
        note: 'Public annotation text only is embedded. Long search documents are truncated by the tokenizer; answer evidence uses original annotations. Vectors stay in memory; verified matches are saved locally for refreshes.',
      },
    });
    this.prepared = { identity: key, source, total, result, documents };
    this.update({
      indexReady: true,
      matchCount: result.matches.length,
      excludedCount: result.issues.length,
    });
    return this.prepared;
  }
  prepare() {
    if (this.preparation) return this.preparation;
    if (this.disposed || this.state.busy || this.state.switching) return Promise.resolve();
    const controller = new AbortController();
    this.controller = controller;
    const signal = controller.signal;
    this.update({
      busy: true,
      activity: 'preparing',
      phase: 'checking',
      error: null,
      preparationJourney: createEmbeddingsJourney(),
      progressText: 'Preparing local search…',
    });
    this.preparation = (async () => {
      try {
        if (this.file && !this.genome.cacheKey) {
          this.update({
            progressText: 'Checking your genome file and identifying its contents locally…',
          });
          const genome = await this.identify(this.file, {
            signal,
            onProgress: ({ bytes }) => {
              if (!signal.aborted)
                this.update({
                  progressText: `Identifying file locally · ${Math.round((100 * bytes) / this.file!.size)}%`,
                });
            },
          });
          signal.throwIfAborted();
          this.genome = genome;
          this.update({ genome });
        }
        await this.prepareIndex(signal);
        signal.throwIfAborted();
        this.update({ phase: 'ready' });
      } catch (error) {
        this.prepared = null;
        this.search.dispose();
        this.update({
          phase: signal.aborted ? 'stopped' : 'error',
          indexReady: false,
          preparationJourney: finishJourney(
            this.state.preparationJourney,
            signal.aborted ? 'stopped' : 'error',
            signal.aborted
              ? 'Preparation stopped'
              : error instanceof Error
                ? error.message
                : String(error),
          ),
          error: signal.aborted
            ? null
            : { message: error instanceof Error ? error.message : String(error) },
        });
      } finally {
        this.controller = null;
        this.preparation = null;
        this.update({ busy: false, activity: null, stopping: false, progressText: '' });
      }
    })();
    return this.preparation;
  }
  async send(text: string) {
    const question = text.trim();
    if (
      !question ||
      this.disposed ||
      this.state.busy ||
      this.state.switching ||
      this.local.state.phase !== 'ready' ||
      this.local.state.busy ||
      this.local.state.reserved
    )
      return false;
    const lease = this.local.reserve();
    const controller = new AbortController();
    this.controller = controller;
    const signal = controller.signal;
    const userId = ++this.nextId;
    const id = ++this.nextId;
    this.update({
      busy: true,
      activity: 'answering',
      error: null,
      messages: [
        ...this.state.messages,
        { id: userId, role: 'user', content: question },
        {
          id,
          role: 'assistant',
          question,
          content: '',
          status: 'streaming',
          model: lease.model,
          genomeSource: genomeProvenance(this.genome),
          journey: createEmbeddingsJourney(),
        },
      ],
    });
    try {
      this.step(id, 'query', {
        status: 'running',
        summary: 'Resolving the latest question and any references locally…',
      });
      const planning = buildLocalQueryContext(question, this.history, lease.model);
      const { messages: queryMessages, generation, ...historyBudget } = planning;
      let queryText = '';
      let queryFinish;
      let queryRequest: ModelRequest | undefined;
      for await (const chunk of this.local.completePrivate(queryMessages, {
        signal,
        lease,
        generation,
        onRequest: (request) => {
          queryRequest = structuredClone(request);
          this.step(id, 'query', { data: { request: queryRequest, ...historyBudget } });
        },
      })) {
        queryText += chunk.choices?.[0]?.delta?.content ?? '';
        queryFinish = chunk.choices?.[0]?.finish_reason ?? queryFinish;
      }
      if (queryFinish !== 'stop')
        throw new Error('Local search planning did not finish normally. Please try again.');
      const plan = parseLocalQuery(queryText);
      this.step(id, 'query', {
        status: 'complete',
        summary: `${PLAN_LABELS[plan.mode]} · selected by the local planner`,
        data: {
          request: queryRequest,
          response: plan,
          decisionSource: 'local_model',
          ...historyBudget,
        },
      });
      if (plan.mode === 'other') {
        await this.answerGeneral(id, question, lease, signal);
        return true;
      }
      const prepared = await this.prepareIndex(signal, id);
      this.updateMessage(id, { result: prepared.result });
      const ranked = await this.retrieve(prepared, plan, signal, id);
      this.step(id, 'context', {
        status: 'running',
        summary: 'Preparing compact records within the selected model’s context budget…',
      });
      const context = buildEmbeddingsContext(
        question,
        ranked,
        prepared.result,
        lease.model,
        plan,
        this.history,
        {
          genomeSource: this.genome,
        },
      );
      const { messages, ...details } = context;
      this.updateMessage(id, { context: details, stage: 'local' });
      this.step(id, 'context', { data: { messages, ...details } });
      this.update({
        progressText: `${lease.model.shortLabel} is answering from the matched records…`,
      });
      let raw = '';
      let finishReason;
      let usage;
      for await (const chunk of this.local.completePrivate(messages, {
        signal,
        lease,
        generation: context.generation,
        onRequest: (request) => {
          this.updateMessage(id, { context: { ...details, submitted: true } });
          this.step(id, 'context', {
            status: 'complete',
            summary: `${context.included} current records sent · ${context.historyTurns} earlier turns · ${context.inputBytes.toLocaleString()} input bytes`,
            data: { ...details, submitted: true, request: structuredClone(request) },
          });
          this.step(id, 'answer', { status: 'running', summary: 'Selecting relevant records…' });
        },
      })) {
        raw += chunk.choices?.[0]?.delta?.content ?? '';
        finishReason = chunk.choices?.[0]?.finish_reason ?? finishReason;
        usage = chunk.usage ?? usage;
        // Do not display partial JSON or unvalidated selections as an answer.
        this.updateMessage(id, { finishReason, usage });
      }
      this.step(id, 'answer', { data: { raw, finishReason, usage } });
      if (finishReason !== 'stop')
        throw new Error(
          'The local record selection did not finish normally. No partial answer was displayed. Please try again.',
        );
      const selection = parseRecordSelection(raw, context.recordReference);
      const openingContext = buildEvidenceOpeningContext(
        question,
        selection,
        context.recordReference,
        lease.model,
      );
      let opening = '',
        openingFinish,
        openingUsage,
        openingRequest;
      this.step(id, 'answer', {
        status: 'running',
        summary: 'Writing a brief answer from the selected records…',
      });
      for await (const chunk of this.local.completePrivate(openingContext.messages, {
        signal,
        lease,
        generation: openingContext.generation,
        onRequest: (request) => {
          openingRequest = structuredClone(request);
        },
      })) {
        opening += chunk.choices?.[0]?.delta?.content ?? '';
        openingFinish = chunk.choices?.[0]?.finish_reason ?? openingFinish;
        openingUsage = chunk.usage ?? openingUsage;
      }
      const openingTrace = {
        request: openingRequest,
        raw: opening,
        finishReason: openingFinish,
        usage: openingUsage,
        inputBytes: openingContext.inputBytes,
        inputByteLimit: openingContext.inputByteLimit,
        historyTurns: openingContext.historyTurns,
        omittedHistoryTurns: openingContext.omittedHistoryTurns,
      };
      this.step(id, 'answer', {
        data: { raw, selection, finishReason, usage, opening: openingTrace },
      });
      if (openingFinish !== 'stop' || !opening.trim())
        throw new Error('The short answer did not finish normally. Please try again.');
      const content = renderRecordSelection(selection, context.recordReference, opening);
      const selected = new Set(selection.selected);
      const supplied = [...context.evidence.matches, ...context.evidence.earlierMatches];
      const records = supplied.filter((_, i) =>
        selected.has(context.recordReference.records[i]!.id),
      );
      this.history.push({ identity: prepared.identity, question, answer: content, records });
      this.updateMessage(id, {
        status: 'complete',
        content,
        answerSelection: selection,
        evidenceAnswer: true,
        usage: openingUsage,
        finishReason: openingFinish,
      });
      this.step(id, 'answer', {
        status: 'complete',
        summary: `${selection.selected.length} records selected · brief answer and source details displayed`,
        data: { raw, selection, rendered: content, finishReason, usage, opening: openingTrace },
      });
      this.end(id, 'complete');
    } catch (error) {
      const message =
        this.local.state.error?.message ||
        (error instanceof Error ? error.message : String(error)) ||
        String(error);
      this.updateMessage(id, { status: signal.aborted ? 'stopped' : 'error' });
      this.end(
        id,
        signal.aborted ? 'stopped' : 'error',
        signal.aborted ? 'Stopped by you' : message,
      );
      if (!signal.aborted) this.update({ error: { message } });
      // Worker cancellation terminates its private index. Rebuild explicitly.
      if (signal.aborted || !this.prepared || this.search.hasIndex === false) {
        this.prepared = null;
        this.search.dispose();
        this.update({ indexReady: false });
      }
    } finally {
      this.local.release(lease);
      this.controller = null;
      this.update({ busy: false, activity: null, stopping: false, progressText: '' });
    }
    return true;
  }
  async retrieve(prepared: PreparedIndex, plan: SearchPlan, signal: AbortSignal, id: number) {
    const weights = { ...this.state.weights };
    const matches = prepared.result.matches;
    this.step(id, 'semantic', {
      status: 'running',
      summary: `Considering all ${matches.length.toLocaleString()} usable matches…`,
    });
    this.update({ progressText: 'Finding relevant matches locally…' });
    let ordered;
    if (plan.mode === 'search') {
      const scores = await this.search.call('score', { query: plan.query }, { signal });
      signal?.throwIfAborted();
      ordered = rankCombined(scores, matches, weights);
    } else {
      ordered = rankCatalogOverview(matches);
    }
    const rows = ordered.slice(0, PREVIEW_LIMIT).map((hit) => ({
      ...hit,
      record: compactMatch(matches[hit.index]!),
      searchText: prepared.documents[hit.index]!,
    }));
    this.step(id, 'semantic', {
      status: 'complete',
      summary: `${matches.length.toLocaleString()} matches considered · ${plan.mode === 'search' ? 'one combined score' : 'catalog overview'}`,
      data: {
        mode: plan.mode,
        query: plan.query,
        weights,
        formula: plan.mode === 'search' ? FORMULA : 'Classification → review stars → catalog order',
        total: matches.length,
        rows,
        scores: ordered,
        previewLimit: PREVIEW_LIMIT,
        note: 'App review weights, not learned weights or probabilities. All usable matches are considered before the answer-context limit.',
      },
    });
    return ordered.map((hit) => matches[hit.index]!);
  }
  async answerGeneral(id: number, question: string, lease: ModelLease, signal: AbortSignal) {
    const context = buildGeneralContext(question, this.history, lease.model);
    const { messages, ...details } = context;
    for (const step of ['catalog', 'matching', 'index', 'semantic'])
      this.step(id, step, { status: 'skipped', summary: 'Other: no new genome search.' });
    this.updateMessage(id, { general: true, stage: 'local', context: details });
    this.step(id, 'context', {
      status: 'running',
      summary: 'Preparing the question and conversation history.',
      data: { messages, ...details },
    });
    this.update({ progressText: 'Answering on this device…' });
    let content = '';
    let finishReason;
    let usage;
    for await (const chunk of this.local.completePrivate(messages, {
      signal,
      lease,
      generation: context.generation,
      onRequest: (request) => {
        this.updateMessage(id, { context: { ...details, submitted: true } });
        this.step(id, 'context', {
          status: 'complete',
          summary: 'Question and conversation sent; no new record reference.',
          data: { ...details, submitted: true, request: structuredClone(request) },
        });
        this.step(id, 'answer', {
          status: 'running',
          summary: 'Responding or asking for clarification locally.',
        });
      },
    })) {
      content += chunk.choices?.[0]?.delta?.content ?? '';
      finishReason = chunk.choices?.[0]?.finish_reason ?? finishReason;
      usage = chunk.usage ?? usage;
      this.updateMessage(id, { content, finishReason, usage });
    }
    if (!content.trim())
      throw new Error('The local model returned an empty answer. Please try again.');
    const limited = finishReason === 'length';
    if (!limited && finishReason !== 'stop')
      throw new Error('The local answer did not finish normally.');
    if (!limited) this.history.push({ question, answer: content, records: [] });

    this.updateMessage(id, { status: 'complete', limited });
    this.step(id, 'answer', {
      status: limited ? 'limited' : 'complete',
      summary: 'Conversation response · no new record search.',
      data: { raw: content, finishReason, usage },
    });
    this.end(id, limited ? 'limited' : 'complete');
  }
  end(id: number, status: StepStatus, reason?: string) {
    const m = this.state.messages.find((m) => m.id === id);
    this.updateMessage(id, { journey: finishJourney(m!.journey!, status, reason) });
  }
  stop() {
    this.update({ stopping: true });
    this.controller?.abort();
  }
  clear() {
    if (!this.state.busy) {
      this.history = [];
      this.update({ messages: [], error: null });
    }
  }
  forget() {
    if (!this.state.busy && !this.state.switching) {
      this.clear();
      this.prepared = null;
      this.search.dispose();
      this.update({
        phase: 'stopped',
        indexReady: false,
        matchCount: 0,
        excludedCount: 0,
        preparationJourney: createEmbeddingsJourney(),
        matchCacheInfo: this.matchCache.clear(),
      });
    }
  }
  dispose() {
    this.disposed = true;
    ++this.selection;
    this.controller?.abort();
    this.search.dispose();
    this.history = [];
    this.prepared = null;
    this.file = null;
    this.listeners.clear();
  }
}
export const embeddingsSession = new EmbeddingsSession();
if (import.meta.hot) import.meta.hot.dispose(() => embeddingsSession.dispose());
