import test from 'node:test';
import assert from 'node:assert/strict';
import { prebuiltAppConfig } from '@mlc-ai/web-llm';
import {
  findModel,
  loadCustomModels,
  modelIdFromLink,
  resolveCustomModel,
  saveCustomModels,
} from '../src/lib/custom-models.ts';
import { localContextBudget } from '../src/config/local-inference.ts';

const id = 'Phi-4-mini-instruct-q4f16_1-MLC';
const settings = (context: unknown) => async (url: RequestInfo | URL) => {
  assert.equal(
    String(url),
    `https://huggingface.co/mlc-ai/${id}/resolve/main/mlc-chat-config.json`,
  );
  return Response.json({ context_window_size: context });
};

test('a model link must name a WebLLM-compiled Hugging Face repository', () => {
  for (const link of [id, `mlc-ai/${id}`, ` https://huggingface.co/mlc-ai/${id}/tree/main `])
    assert.equal(modelIdFromLink(link), id);
  assert.throws(() => modelIdFromLink('https://example.com/mlc-ai/' + id), /huggingface\.co/);
  assert.throws(() => modelIdFromLink('https://huggingface.co/someone/model-GGUF'), /WebLLM/);
  assert.throws(() => modelIdFromLink('  '), /WebLLM/);
});

test('an added model uses the pinned catalog and a capped context that fits the app budget', async () => {
  const profile = await resolveCustomModel(id, { fetchImpl: settings(131072) });
  assert.deepEqual(
    { ...profile, blurb: undefined },
    {
      id,
      modelId: id,
      label: 'Phi-4-mini-instruct',
      shortLabel: 'Phi-4-mini-instruct',
      contextWindowTokens: 32768,
      generation: {},
      blurb: undefined,
      custom: true,
    },
  );
  assert.ok(prebuiltAppConfig.model_list.some((record) => record.model_id === profile.modelId));
  assert.ok(localContextBudget(profile).inputByteLimit > 0);
  saveCustomModels([profile]);
  assert.deepEqual(loadCustomModels(), [profile]);
  assert.equal(findModel(id), profile);
  assert.equal(findModel('qwen3-4b').modelId, 'Qwen3-4B-q4f16_1-MLC');
  await assert.rejects(resolveCustomModel(id, { fetchImpl: settings(131072) }), /already/);
  saveCustomModels([]);
  assert.throws(() => findModel(id), /Unknown local model/);
});

test('unsupported, built-in, non-chat and small-context models are refused', async () => {
  const never = async () => assert.fail('No request expected');
  await assert.rejects(resolveCustomModel('Not-A-Model-MLC', { fetchImpl: never }), /can run/);
  await assert.rejects(
    resolveCustomModel('Qwen3-4B-q4f16_1-MLC', { fetchImpl: never }),
    /already in your list/,
  );
  await assert.rejects(
    resolveCustomModel('snowflake-arctic-embed-m-q0f32-MLC-b4', { fetchImpl: never }),
    /text chat/,
  );
  await assert.rejects(resolveCustomModel(id, { fetchImpl: settings(4096) }), /4,096 tokens/);
  await assert.rejects(resolveCustomModel(id, { fetchImpl: settings('x') }), /unknown number/);
  await assert.rejects(
    resolveCustomModel(id, { fetchImpl: async () => new Response('', { status: 404 }) }),
    /Could not read/,
  );
});
