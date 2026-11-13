import type {
  ModelProfile,
  ModelEngine,
  EngineOptions,
  ModelLease,
  CompletionOptions,
  ModelMessage,
} from './types.ts';

export interface LocalModelState {
  model: ModelProfile | null;
  reserved: boolean;
  phase: 'unselected' | 'idle' | 'checking' | 'loading' | 'ready' | 'switching' | 'error';
  progress: number;
  progressText: string;
  gpu: string;
  busy: boolean;
  stopping: boolean;
  error: { message: string; detail?: string } | null;
}
interface SessionOptions {
  checkSupport?: () => Promise<string>;
  createEngine?: (options: EngineOptions) => Promise<ModelEngine>;
  modelId?: string | null;
}
import { checkWebGPU, explainError } from './model.ts';
import { getModelProfile } from '../config/models/index.ts';
import { localModelRequest } from './local-model-request.ts';

// Model selection, GPU lifetime and isolated inference. Conversation state lives in EmbeddingsSession.
export class LocalModelSession {
  checkSupport: () => Promise<string>;
  createEngine: (options: EngineOptions) => Promise<ModelEngine>;
  listeners: Set<() => void>;
  engine: ModelEngine | null;
  epoch: number;
  reservation: ModelLease | null;
  state: LocalModelState;
  constructor({ checkSupport = checkWebGPU, createEngine, modelId = null }: SessionOptions = {}) {
    this.checkSupport = checkSupport;
    this.createEngine =
      createEngine ??
      (async (callbacks) => {
        const { createLocalEngine } = await import('./webllm.ts');
        return createLocalEngine(callbacks);
      });
    this.listeners = new Set();
    this.engine = null;
    this.epoch = 0;
    this.reservation = null;
    this.state = {
      model: modelId === null ? null : getModelProfile(modelId),
      reserved: false,
      phase: modelId === null ? 'unselected' : 'idle',
      progress: 0,
      progressText: 'Choose a local model to begin.',
      gpu: 'No local model loaded',
      busy: false,
      stopping: false,
      error: null,
    };
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  update(patch: Partial<LocalModelState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  async initialize() {
    if (
      !this.state.model ||
      ['switching', 'checking', 'loading', 'ready'].includes(this.state.phase) ||
      this.state.reserved
    )
      return;
    const epoch = ++this.epoch;
    const profile = this.state.model;
    this.engine?.dispose();
    this.engine = null;
    this.update({ phase: 'checking', progress: 0, error: null, busy: false, stopping: false });
    try {
      const gpu = await this.checkSupport();
      if (epoch !== this.epoch) return;
      this.update({
        phase: 'loading',
        gpu,
        progressText: `Loading ${profile.label}. The first download may take several minutes…`,
      });
      const engine = await this.createEngine({
        profile,
        onProgress: ({ progress, text }) => {
          if (epoch !== this.epoch) return;
          this.update({
            progress: Math.max(0, Math.min(1, Number(progress) || 0)),
            progressText: text,
          });
        },
        onFatal: (error) => {
          if (epoch !== this.epoch) return;
          ++this.epoch;
          this.update({
            phase: 'error',
            busy: false,
            stopping: false,
            error: explainError(error, profile),
          });
        },
      });
      if (epoch !== this.epoch) {
        engine.dispose();
        return;
      }
      this.engine = engine;
      this.update({
        phase: 'ready',
        progress: 1,
        progressText: `${profile.label} is ready on your device.`,
      });
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.update({
        phase: 'error',
        error: explainError(error, profile),
        gpu: this.state.phase === 'checking' ? 'WebGPU check failed' : this.state.gpu,
      });
    }
  }

  async selectModel(modelId: string) {
    const profile = getModelProfile(modelId);
    if (
      this.state.busy ||
      this.state.reserved ||
      ['switching', 'checking', 'loading'].includes(this.state.phase)
    )
      return false;
    if (profile.id === this.state.model?.id) return false;
    const epoch = ++this.epoch;
    const previous = this.engine;
    this.engine = null;
    this.update({
      model: profile,
      phase: 'switching',
      progress: 0,
      error: null,
      progressText: 'Releasing the previous model’s GPU memory…',
    });
    try {
      // Await WebLLM's GPU cleanup before allocating the next model. Always
      // dispose the old worker, including when unload fails on a lost device.
      if (previous) await previous.unload();
    } catch (error) {
      if (epoch !== this.epoch) return false;
      this.update({ phase: 'error', error: explainError(error, profile) });
      return false;
    } finally {
      previous?.dispose();
    }
    if (epoch !== this.epoch) return false;
    this.update({ phase: 'idle' });
    await this.initialize();
    return this.state.phase === 'ready';
  }

  // Hold one selected profile throughout planning, matching and answer generation.
  reserve() {
    if (this.state.phase !== 'ready' || this.state.busy || this.reservation || !this.state.model)
      throw new Error('Wait for the local model to be ready.');
    const lease = Object.freeze({ model: this.state.model, epoch: this.epoch });
    this.reservation = lease;
    this.update({ reserved: true });
    return lease;
  }
  release(lease: ModelLease) {
    if (this.reservation !== lease) return;
    this.reservation = null;
    this.update({ reserved: false });
  }

  // Each inference pass receives explicit messages and resets its KV cache.
  async *completePrivate(
    messages: ModelMessage[],
    { signal, onRequest = () => {}, lease, generation = {} }: CompletionOptions = {},
  ) {
    const validLease = lease
      ? lease === this.reservation && lease.epoch === this.epoch
      : !this.reservation;
    if (
      this.state.phase !== 'ready' ||
      this.state.busy ||
      !validLease ||
      !this.state.model ||
      !this.engine
    )
      throw new Error('Wait for the local model to be ready.');
    const epoch = this.epoch;
    const profile = this.state.model;
    const engine = this.engine;
    let inferenceError;
    signal?.throwIfAborted();
    const abort = () => engine.interrupt();
    signal?.addEventListener('abort', abort, { once: true });
    this.update({ busy: true });
    try {
      await engine.reset();
      signal?.throwIfAborted();
      const request = { ...localModelRequest(profile, messages), ...generation };
      onRequest(request);
      for await (const chunk of engine.complete(request)) {
        signal?.throwIfAborted();
        if (epoch !== this.epoch) throw new Error('The local model stopped unexpectedly.');
        yield chunk;
      }
    } catch (error) {
      inferenceError = error;
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
      try {
        await engine.reset();
      } catch (error) {
        engine.dispose();
        if (epoch === this.epoch) {
          this.engine = null;
          this.update({ phase: 'error', error: explainError(inferenceError ?? error, profile) });
        }
      }
      if (epoch === this.epoch) this.update({ busy: false, stopping: false });
    }
  }

  dispose() {
    ++this.epoch;
    this.engine?.dispose();
    this.engine = null;
    this.reservation = null;
    this.listeners.clear();
  }
}

export const localModelSession = new LocalModelSession();
if (import.meta.hot) import.meta.hot.dispose(() => localModelSession.dispose());
