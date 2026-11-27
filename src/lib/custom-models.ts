import type { ModelProfile } from './types.ts';
import type { Fetcher } from '../vendor/genomewalk/io/types.ts';
import { LOCAL_MODELS, getModelProfile } from '../config/models/index.ts';

// Models a user adds from a Hugging Face link. Only models the installed WebLLM
// release can run are accepted, so weights and compiled code always come from its
// catalog. The list is kept in this browser; nothing is sent to an app server.
const STORAGE_KEY = 'genomewalk.custom-models';
const MAX_CONTEXT_TOKENS = 32768; // Same browser window as the largest built-in profile.
export const MIN_CONTEXT_TOKENS = 8192;

export function modelIdFromLink(input: string) {
  let path = input.trim();
  if (/^https?:\/\//i.test(path)) {
    const url = new URL(path);
    if (url.hostname !== 'huggingface.co') throw new Error('Paste a link from huggingface.co.');
    path = url.pathname;
  }
  const [owner, name] = path.split('/').filter(Boolean);
  const modelId = name ?? owner;
  if (!modelId || (name && owner !== 'mlc-ai'))
    throw new Error(
      'Only models compiled for WebLLM can run here. Paste a link like huggingface.co/mlc-ai/…-MLC.',
    );
  return modelId;
}

// A model's own context size, read from its public settings file on Hugging Face.
export async function modelContext(
  modelUrl: string,
  fetchImpl: Fetcher = (...args) => fetch(...args),
) {
  const response = await fetchImpl(`${modelUrl}/resolve/main/mlc-chat-config.json`);
  if (!response.ok) throw new Error('Could not read that model’s settings from Hugging Face.');
  return Number((await response.json()).context_window_size);
}

export async function resolveCustomModel(
  input: string,
  { fetchImpl }: { fetchImpl?: Fetcher } = {},
): Promise<ModelProfile> {
  const modelId = modelIdFromLink(input);
  if ([...LOCAL_MODELS, ...loadCustomModels()].some((model) => model.modelId === modelId))
    throw new Error('That model is already in your list.');
  // Loaded on demand: the runtime's catalog is large.
  const { prebuiltAppConfig } = await import('@mlc-ai/web-llm');
  const record = prebuiltAppConfig.model_list.find((entry) => entry.model_id === modelId);
  if (!record) throw new Error(`${modelId} is not a model this app’s WebLLM version can run.`);
  if (record.model_type) throw new Error('Only text chat models can be added.');
  const context = await modelContext(record.model, fetchImpl);
  if (!Number.isInteger(context) || context < MIN_CONTEXT_TOKENS)
    throw new Error(
      `This model can read ${Number.isInteger(context) ? context.toLocaleString() : 'an unknown number of'} tokens at a time. This app needs at least ${MIN_CONTEXT_TOKENS.toLocaleString()} to fit its instructions, your records and the answer.`,
    );
  const label = modelId.replace(/-MLC$/, '').replace(/-q\d\w*$/, '');
  return {
    id: modelId,
    modelId,
    label,
    shortLabel: label,
    contextWindowTokens: Math.min(context, MAX_CONTEXT_TOKENS),
    generation: {},
    blurb: 'Added by you. Uses the model’s own default settings; not checked with this app.',
    custom: true,
  };
}

// The list as last saved in this visit; it also covers browsers without storage.
let savedThisVisit: ModelProfile[] | null = null;

export function loadCustomModels(): ModelProfile[] {
  if (savedThisVisit) return savedThisVisit;
  if (typeof document === 'undefined') return []; // Outside a browser page there is no saved list.
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(saved)) return [];
    return saved.filter(
      (model): model is ModelProfile =>
        typeof model?.modelId === 'string' &&
        model.id === model.modelId &&
        typeof model.label === 'string' &&
        Number.isInteger(model.contextWindowTokens) &&
        model.custom === true,
    );
  } catch {
    return []; // No browser storage (or unreadable): only the built-in models.
  }
}

export function saveCustomModels(models: ModelProfile[]) {
  savedThisVisit = models;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(models));
  } catch {
    /* The model stays usable for this visit. */
  }
}

export function findModel(id: string) {
  return loadCustomModels().find((model) => model.id === id) ?? getModelProfile(id);
}
