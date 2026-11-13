import type {
  ModelRequest,
  ModelEngine,
  ModelMessage,
  ModelChunk,
  EngineOptions,
} from '../src/lib/types.ts';
import { fakeEngine } from './helpers/inference.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalModelSession } from '../src/lib/local-model-session.ts';
import { getModelProfile, LOCAL_MODELS } from '../src/config/models/index.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(overrides: Partial<ModelEngine> = {}) {
  const requests: ModelRequest[] = [];
  const calls = { reset: 0, dispose: 0, interrupt: 0, create: 0 };
  const engine = fakeEngine({
    async *complete(request) {
      requests.push(request);
      yield { choices: [{ delta: { content: 'Hello' } }] };
      yield { choices: [{ delta: { content: ' there.' }, finish_reason: 'stop' }] };
    },
    async reset() {
      calls.reset++;
    },
    async unload() {},
    dispose() {
      calls.dispose++;
    },
    interrupt() {
      calls.interrupt++;
    },
    ...overrides,
  });
  let callbacks!: EngineOptions;
  const session = new LocalModelSession({
    modelId: 'llama-3.1-8b',
    checkSupport: async () => 'WebGPU supported · float16',
    createEngine: async (value) => {
      callbacks = value;
      calls.create++;
      return engine;
    },
  });
  return {
    session,
    engine,
    requests,
    calls,
    get callbacks() {
      return callbacks;
    },
  };
}

test('fresh sessions perform no GPU or model work until an explicit model selection', async () => {
  for (const profile of LOCAL_MODELS) {
    let checked = 0,
      created = 0;
    const session = new LocalModelSession({
      checkSupport: async () => {
        checked++;
        return 'Supported';
      },
      createEngine: async ({ profile: selected }) => {
        created++;
        assert.equal(selected.id, profile.id);
        return fakeEngine({ dispose() {} });
      },
    });
    assert.equal(session.state.model, null);
    assert.equal(session.state.phase, 'unselected');
    await session.initialize();
    await session.initialize();
    assert.equal(checked, 0);
    assert.equal(created, 0);
    await assert.rejects(() => collect(session.completePrivate([])), /Wait for/);
    assert.equal(await session.selectModel(profile.id), true);
    assert.equal(session.state.phase, 'ready');
    assert.equal(checked, 1);
    assert.equal(created, 1);
    await session.initialize();
    await session.selectModel(profile.id);
    assert.equal(created, 1);
    session.dispose();
  }
});

test('deduplicates initialization and publishes real loader progress before enabling chat', async () => {
  const gate = deferred();
  let created = 0;
  const session = new LocalModelSession({
    modelId: 'llama-3.1-8b',
    checkSupport: async () => 'Supported',
    createEngine: async ({ onProgress }) => {
      created++;
      onProgress({ progress: 0.4, text: 'Downloading weights' });
      await gate.promise;
      return fakeEngine({ dispose() {} });
    },
  });
  const initialization = session.initialize();
  await session.initialize();
  assert.equal(created, 1);
  assert.equal(session.state.phase, 'loading');
  assert.equal(session.state.progress, 0.4);
  await assert.rejects(() => collect(session.completePrivate([])), /Wait for/);
  gate.resolve();
  await initialization;
  assert.equal(session.state.phase, 'ready');
  assert.equal(session.state.progress, 1);
});

test('initialization failures can be retried, without loading anything when WebGPU is unsupported', async () => {
  const f = fixture();
  f.session.checkSupport = async () => {
    throw new Error('WebGPU unavailable');
  };
  await f.session.initialize();
  assert.equal(f.calls.create, 0);
  assert.equal(f.session.state.phase, 'error');
  f.session.checkSupport = async () => 'Supported';
  await f.session.initialize();
  assert.equal(f.session.state.phase, 'ready');
});

test('a failed model download is retryable and a disposed initialization cannot resurrect the session', async () => {
  const gate = deferred();
  const f = fixture();
  f.session.createEngine = async () => {
    throw new Error('Failed to fetch model');
  };
  await f.session.initialize();
  assert.equal(f.session.state.phase, 'error');
  assert.match(f.session.state.error!.message, /could not be downloaded/);
  f.session.createEngine = async () => {
    await gate.promise;
    return f.engine;
  };
  const pending = f.session.initialize();
  await Promise.resolve();
  f.session.dispose();
  gate.resolve();
  await pending;
  assert.equal(f.calls.dispose, 1);
  assert.notEqual(f.session.state.phase, 'ready');
});

test('switching awaits GPU unload and ignores callbacks from the old worker', async () => {
  const released = deferred();
  const f = fixture({ unload: () => released.promise });
  await f.session.initialize();
  await collect(f.session.completePrivate([{ role: 'user', content: 'First model' }]));
  const originalCallbacks = f.callbacks;
  const switching = f.session.selectModel('qwen3-4b');
  assert.equal(f.session.state.phase, 'switching');
  assert.equal(f.calls.create, 1, 'The next model cannot allocate before GPU cleanup');
  await assert.rejects(() => collect(f.session.completePrivate([])), /Wait for/);
  assert.equal(await f.session.selectModel('llama-3.1-8b'), false);
  await f.session.initialize();
  assert.equal(f.calls.create, 1);
  originalCallbacks.onProgress({ progress: 0.9, text: 'Stale progress' });
  originalCallbacks.onFatal(new Error('Stale worker failure'));
  assert.equal(f.session.state.phase, 'switching');
  released.resolve();
  assert.equal(await switching, true);
  assert.equal(f.calls.create, 2);
  assert.equal(f.calls.dispose, 1);
  await collect(f.session.completePrivate([{ role: 'user', content: 'New context' }]));
  assert.equal(f.requests[1]!.messages.length, 1);
  assert.equal(f.requests[1]!.model, getModelProfile('qwen3-4b').modelId);
  assert.deepEqual(f.requests[1]!.extra_body, { enable_thinking: false });
  assert.equal(f.requests[1]!.max_tokens, 32768);
});

test('The workflow reserves one profile through matching and inference, preventing model changes', async () => {
  const f = fixture();
  await f.session.initialize();
  const lease = f.session.reserve();
  assert.equal(await f.session.selectModel('qwen3-4b'), false);
  assert.equal(f.calls.reset, 0);
  assert.throws(() => f.session.reserve(), /Wait for/);
  await assert.rejects(async () => {
    for await (const _ of f.session.completePrivate([])) {
    }
  }, /Wait for/);
  let captured: ModelRequest | undefined;
  for await (const _ of f.session.completePrivate([{ role: 'user', content: 'Synthetic' }], {
    lease,
    onRequest: (request) => {
      captured = request;
    },
  })) {
  }
  assert.equal(captured!.model, lease.model.modelId);
  assert.equal(captured!.max_tokens, lease.model.contextWindowTokens);
  assert.equal(captured!.extra_body, undefined);
  assert.equal(f.session.state.reserved, true);
  assert.equal(f.session.state.busy, false);
  f.session.release({ epoch: -1, model: lease.model });
  assert.equal(f.session.state.reserved, true);
  f.session.release(lease);
  assert.equal(f.session.state.reserved, false);
  await f.session.selectModel('qwen3-4b');
  await assert.rejects(async () => {
    for await (const _ of f.session.completePrivate([], { lease })) {
    }
  }, /Wait for/);
});

test('switching is blocked during generation and a failed switch can recover to the prior model', async () => {
  const gate = deferred();
  const f = fixture({
    async *complete() {
      await gate.promise;
      yield { choices: [{ delta: { content: 'Test' } }] };
    },
  });
  await f.session.initialize();
  const pending = collect(f.session.completePrivate([{ role: 'user', content: 'Question' }]));
  assert.equal(await f.session.selectModel('qwen3-4b'), false);
  gate.resolve();
  await pending;
  const factory = f.session.createEngine;
  f.session.createEngine = async (options) => {
    if (options.profile.id === 'qwen3-4b') throw new Error('Failed to fetch');
    return factory(options);
  };
  assert.equal(await f.session.selectModel('qwen3-4b'), false);
  assert.equal(f.session.state.phase, 'error');
  assert.equal(f.session.state.model!.id, 'qwen3-4b');
  assert.equal(await f.session.selectModel('llama-3.1-8b'), true);
  assert.equal(f.session.state.model!.id, 'llama-3.1-8b');
  await assert.rejects(f.session.selectModel('unknown'), /Unknown local model/);
  assert.equal(f.session.state.phase, 'ready');
});

test('GPU unload failure terminates the old worker and leaves a visible retryable error', async () => {
  const f = fixture({
    async unload() {
      throw new Error('GPU device lost');
    },
  });
  await f.session.initialize();
  assert.equal(await f.session.selectModel('qwen3-4b'), false);
  assert.equal(f.calls.create, 1);
  assert.equal(f.calls.dispose, 1);
  assert.equal(f.session.state.phase, 'error');
  assert.match(f.session.state.error!.detail!, /GPU device lost/);
  await f.session.initialize();
  assert.equal(f.session.state.phase, 'ready');
});

test('Model-specific configuration does not leak when switching back from Qwen3.5', async () => {
  const f = fixture();
  await f.session.initialize();
  assert.equal(await f.session.selectModel('qwen3.5-9b'), true);
  assert.equal(f.callbacks.profile.id, 'qwen3.5-9b');
  await collect(f.session.completePrivate([{ role: 'user', content: 'Synthetic question' }]));
  const lease = f.session.reserve();
  for await (const _ of f.session.completePrivate(
    [{ role: 'user', content: 'Synthetic reference' }],
    { lease },
  )) {
  }
  f.session.release(lease);
  for (const request of f.requests) {
    assert.equal(request.model, 'Qwen3.5-9B-q4f16_1-MLC');
    assert.equal(request.max_tokens, 131072);
    assert.deepEqual(request.extra_body, { enable_thinking: false });
  }
  assert.equal(await f.session.selectModel('llama-3.1-8b'), true);
  await collect(f.session.completePrivate([{ role: 'user', content: 'New context' }]));
  assert.equal(f.requests.at(-1)!.extra_body, undefined);
  assert.equal(f.requests.at(-1)!.repetition_penalty, undefined);
});

async function collect(iterator: AsyncIterable<ModelChunk>) {
  const chunks = [];
  for await (const chunk of iterator) chunks.push(chunk);
  return chunks;
}

test('every selectable model receives the same supplied messages without rewriting', async () => {
  const messages: ModelMessage[] = [
    { role: 'system', content: 'Shared rules' },
    { role: 'user', content: 'Supplied reference' },
  ];
  for (const profile of LOCAL_MODELS) {
    const f = fixture();
    await f.session.initialize();
    if (f.session.state.model!.id !== profile.id) await f.session.selectModel(profile.id);
    await collect(f.session.completePrivate(messages));
    assert.deepEqual(f.requests[0]!.messages, messages);
    assert.equal(f.requests[0]!.model, profile.modelId);
    assert.equal(f.requests[0]!.max_tokens, profile.contextWindowTokens);
    f.session.dispose();
  }
});

test('inference streams unmodified chunks and resets KV state between explicit requests', async () => {
  const raw = '<think>raw model output</think>\n\n## Source facts';
  const f = fixture({
    async *complete(request) {
      f.requests.push(request);
      yield { choices: [{ delta: { content: raw }, finish_reason: 'stop' }] };
    },
  });
  await f.session.initialize();
  let captured: ModelRequest | undefined;
  const messages: ModelMessage[] = [{ role: 'user', content: 'First request' }];
  const chunks = await collect(
    f.session.completePrivate(messages, {
      onRequest: (request) => {
        captured = request;
      },
    }),
  );
  assert.deepEqual(captured!.messages, messages);
  assert.equal(chunks[0]!.choices[0]!.delta.content, raw);
  await collect(f.session.completePrivate([{ role: 'user', content: 'Second request' }]));
  assert.deepEqual(f.requests[1]!.messages, [{ role: 'user', content: 'Second request' }]);
  assert.equal(f.calls.reset, 4);
  assert.equal('history' in f.session, false, 'Conversation history belongs to EmbeddingsSession');
});

test('fatal worker failure unlocks the runtime and rejects late stream output', async () => {
  const gate = deferred();
  const f = fixture({
    async *complete() {
      await gate.promise;
      yield { choices: [{ delta: { content: 'Too late' } }] };
    },
  });
  await f.session.initialize();
  const pending = collect(f.session.completePrivate([{ role: 'user', content: 'Question' }]));
  const rejected = assert.rejects(pending, /stopped unexpectedly/);
  f.callbacks.onFatal(new Error('Worker crashed'));
  gate.resolve();
  await rejected;
  assert.equal(f.session.state.phase, 'error');
  assert.equal(f.session.state.busy, false);
});

test('private local inference resets KV state, and responds to cancellation', async () => {
  let resets = 0;
  let interrupted = 0;
  let captured: ModelRequest | undefined;
  const engine = fakeEngine({
    reset: async () => {
      resets++;
    },
    interrupt: () => interrupted++,
    dispose: () => {},
    async *complete(request) {
      assert.equal(request.messages[1]!.content, 'PRIVATE_EVIDENCE');
      assert.deepEqual(captured, request);
      yield { choices: [{ delta: { content: 'Local answer' } }] };
    },
  });
  const session = new LocalModelSession({
    modelId: 'llama-3.1-8b',
    checkSupport: async () => 'supported',
    createEngine: async () => engine,
  });
  await session.initialize();
  const controller = new AbortController();
  const iterator = session.completePrivate(
    [
      { role: 'system', content: 'Rules' },
      { role: 'user', content: 'PRIVATE_EVIDENCE' },
    ],
    {
      signal: controller.signal,
      onRequest: (request) => {
        captured = structuredClone(request);
      },
    },
  );
  assert.equal((await iterator.next()).done, false);
  assert.equal(captured!.max_tokens, 131072);
  assert.deepEqual(captured!.stream_options, { include_usage: true });
  assert.equal(session.state.busy, true);
  controller.abort();
  await iterator.return();
  assert.equal(interrupted, 1);
  assert.equal(resets, 2);
  assert.equal(session.state.busy, false);
  assert.ok(!JSON.stringify(session.state).includes('PRIVATE_EVIDENCE'));
});

test('private inference preserves a worker string failure when cleanup also fails', async () => {
  let resets = 0;
  const engine = fakeEngine({
    dispose() {},
    reset: async () => {
      if (++resets > 1) throw new Error('The current Object has already been disposed');
    },
    async *complete() {
      yield await Promise.reject('Original GPU allocation failure');
    },
  });
  const session = new LocalModelSession({
    modelId: 'llama-3.1-8b',
    checkSupport: async () => 'supported',
    createEngine: async () => engine,
  });
  await session.initialize();
  let failure;
  try {
    for await (const _ of session.completePrivate([{ role: 'user', content: 'Synthetic input' }])) {
    }
  } catch (error) {
    failure = error;
  }
  assert.equal(failure, 'Original GPU allocation failure');
  assert.equal(session.state.phase, 'error');
  assert.equal(session.state.error!.detail, 'Original GPU allocation failure');
  assert.equal(session.state.busy, false);
});
