import test from 'node:test';
import assert from 'node:assert/strict';
import { prebuiltAppConfig } from '@mlc-ai/web-llm';
import { checkWebGPU, explainError } from '../src/lib/model.js';
import { LOCAL_MODELS, getModelProfile } from '../src/config/models/index.js';
import {
  localContextBudget,
  LOCAL_MIN_RESPONSE_TOKENS,
  LOCAL_TEMPLATE_RESERVE_TOKENS,
} from '../src/config/local-inference.js';
import { localModelRequest } from '../src/lib/local-model-request.js';

test('each profile uses the pinned WebLLM weights and compatible WASM with its configured context', () => {
  assert.equal(getModelProfile().id, 'llama-3.1-8b');
  const expected = {
    'llama-3.1-8b': { library: 'Llama-3_1-8B-Instruct-q4f16_1_cs1k-webgpu.wasm', context: 131072 },
    'llama-3.2-1b': { library: 'Llama-3.2-1B-Instruct-q4f16_1_cs1k-webgpu.wasm', context: 131072 },
    'llama-3.2-3b': { library: 'Llama-3.2-3B-Instruct-q4f16_1_cs1k-webgpu.wasm', context: 131072 },
    'qwen3-4b': { library: 'Qwen3-4B-q4f16_1_cs1k-webgpu.wasm', context: 32768 },
    'qwen3.5-9b': { library: 'Qwen3.5-9B-q4f16_1_cs1k-webgpu.wasm', context: 131072 },
    'deepseek-r1-qwen-7b': {
      library: 'Qwen2-7B-Instruct-q4f16_1_cs1k-webgpu.wasm',
      context: 131072,
    },
    'deepseek-r1-llama-8b': {
      library: 'Llama-3_1-8B-Instruct-q4f16_1_cs1k-webgpu.wasm',
      context: 131072,
    },
  };
  assert.equal(LOCAL_MODELS.length, Object.keys(expected).length);
  for (const profile of LOCAL_MODELS) {
    const record = prebuiltAppConfig.model_list.find((model) => model.model_id === profile.modelId);
    assert.equal(record.model, `https://huggingface.co/mlc-ai/${profile.modelId}`);
    assert.ok(record.model_lib.endsWith(`/v0_2_87/base/${expected[profile.id].library}`));
    assert.equal(profile.contextWindowTokens, expected[profile.id].context);
    const budget = localContextBudget(profile);
    assert.equal(budget.responseTokenLimit, profile.contextWindowTokens);
    assert.equal(
      budget.inputByteLimit + LOCAL_MIN_RESPONSE_TOKENS + LOCAL_TEMPLATE_RESERVE_TOKENS,
      profile.contextWindowTokens,
    );
  }
  assert.throws(() => getModelProfile('https://untrusted.example/model'), /Unknown local model/);
});

test('Qwen3.5 retains required runtime overrides and uses supported non-thinking options', () => {
  const profile = getModelProfile('qwen3.5-9b');
  const record = prebuiltAppConfig.model_list.find((model) => model.model_id === profile.modelId);
  assert.equal(record.overrides.max_history_size, 1);
  assert.deepEqual(record.overrides.conv_config.stop_token_ids, [248046, 248044]);
  const request = localModelRequest(profile, [{ role: 'user', content: 'Synthetic question' }]);
  assert.equal(profile.nativeContextWindowTokens, 262144);
  assert.equal(request.max_tokens, 131072);
  assert.equal(request.temperature, 0.7);
  assert.equal(request.top_p, 0.8);
  assert.equal(request.presence_penalty, 1.5);
  assert.equal(request.repetition_penalty, 1);
  assert.deepEqual(request.extra_body, { enable_thinking: false });
  assert.equal(localContextBudget(profile).inputByteLimit, 126720);
});

test('generation options are independent: Llama never inherits Qwen thinking or penalty settings', () => {
  const messages = [{ role: 'user', content: 'Test' }];
  const qwen = localModelRequest(getModelProfile('qwen3-4b'), messages);
  assert.deepEqual(qwen.extra_body, { enable_thinking: false });
  assert.equal(qwen.presence_penalty, 1.5);
  for (const id of ['llama-3.1-8b', 'llama-3.2-1b', 'llama-3.2-3b']) {
    const llama = localModelRequest(getModelProfile(id), messages);
    assert.equal(llama.extra_body, undefined);
    assert.equal(llama.presence_penalty, undefined);
    assert.equal(llama.temperature, 0.6);
    assert.equal(llama.top_p, 0.9);
    assert.equal(llama.max_tokens, 131072);
  }
});

test('DeepSeek profiles use their own sampling without unsupported Qwen thinking controls', () => {
  for (const id of ['deepseek-r1-qwen-7b', 'deepseek-r1-llama-8b']) {
    const messages = [
      { role: 'system', content: 'Shared instructions' },
      { role: 'user', content: 'Question' },
    ];
    const request = localModelRequest(getModelProfile(id), messages);
    assert.deepEqual(request.messages, messages);
    assert.equal(request.temperature, 0.6);
    assert.equal(request.top_p, 0.95);
    assert.equal(request.max_tokens, 131072);
    assert.equal(request.extra_body, undefined);
    assert.equal(request.presence_penalty, undefined);
  }
});

test('WebGPU detection covers insecure contexts, missing APIs, missing adapters, and missing float16', async () => {
  await assert.rejects(checkWebGPU({ isSecureContext: false }), /secure context/);
  await assert.rejects(
    checkWebGPU({ isSecureContext: true, navigator: {} }),
    /WebGPU is unavailable/,
  );
  const environment = (adapter) => ({
    isSecureContext: true,
    navigator: { gpu: { requestAdapter: async () => adapter } },
  });
  await assert.rejects(checkWebGPU(environment(null)), /No WebGPU adapter/);
  await assert.rejects(checkWebGPU(environment({ features: new Set() })), /shader-f16/);
  assert.match(await checkWebGPU(environment({ features: new Set(['shader-f16']) })), /supported/);
});

test('GPU, network, and context errors give actionable guidance and retain technical details', () => {
  assert.match(explainError(new Error('GPU device lost')).message, /GPU memory/);
  assert.match(explainError(new Error('Failed to fetch')).message, /connection/);
  assert.match(explainError(new Error('context window exceeded')).message, /131,072-token/);
  const runtime = explainError(new Error('A valid external Instance reference no longer exists.'));
  assert.match(runtime.message, /GPU/);
  assert.match(runtime.detail, /external Instance reference/);
  assert.equal(explainError(new Error('Failed to fetch')).detail, 'Failed to fetch');
});
