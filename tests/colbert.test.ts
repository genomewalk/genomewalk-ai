import test from 'node:test';
import assert from 'node:assert/strict';
import { Tensor } from '@huggingface/transformers';
import { colbertInputs, colbertVectors, maxSim } from '../src/lib/colbert.ts';
import { RETRIEVAL } from '../src/config/search.ts';

// Invented token sequences: no network or downloaded weights in unit tests.
const vocab: Record<string, number> = {
  '[PAD]': 0,
  '[unused0]': 1,
  '[unused1]': 2,
  '[CLS]': 101,
  '[SEP]': 102,
  '[MASK]': 103,
  '.': 1012,
  word: 2000,
};
const tokenizer = {
  encode: (text: string) => (text ? text.split(' ').map((word) => vocab[word] ?? 100) : []),
  convert_tokens_to_ids: <T extends string | string[]>(
    tokens: T,
  ): T extends string ? number : number[] =>
    (Array.isArray(tokens)
      ? tokens.map((token) => vocab[token] ?? 100)
      : (vocab[tokens as string] ?? 100)) as T extends string ? number : number[],
};

test('ColBERT queries attend to real tokens but score all 32 expansion positions', () => {
  const { inputs, masks } = colbertInputs(tokenizer, ['word .'], 'query');
  assert.deepEqual(inputs.input_ids.dims, [1, 32]);
  assert.deepEqual(Array.from(inputs.input_ids.data).slice(0, 7), [
    101n,
    1n,
    2000n,
    1012n,
    102n,
    103n,
    103n,
  ]);
  assert.equal(Array.from(inputs.attention_mask.data).filter(Boolean).length, 5);
  assert.ok(masks[0]!.every(Boolean), 'Query punctuation and expansion tokens both contribute');
  assert.ok(Array.from(inputs.token_type_ids.data).every((id) => id === 0n));
});

test('ColBERT documents exclude padding and punctuation from scoring without removing context', () => {
  const { inputs, masks } = colbertInputs(tokenizer, ['word .', 'word'], 'document');
  assert.deepEqual(inputs.input_ids.dims, [2, 5]);
  assert.deepEqual(Array.from(inputs.input_ids.data), [
    101n,
    2n,
    2000n,
    1012n,
    102n,
    101n,
    2n,
    2000n,
    102n,
    0n,
  ]);
  assert.deepEqual(masks, [
    [true, true, true, false, true],
    [true, true, true, true, false],
  ]);
  assert.equal(inputs.attention_mask.data[3], 1n, 'Punctuation remains visible to the encoder');
  assert.equal(inputs.attention_mask.data[9], 0n);
});

test('ColBERT length limits preserve the prefix and final separator, including empty text', () => {
  for (const kind of ['query', 'document'] as const) {
    const limit = kind === 'query' ? 32 : 300;
    const { inputs } = colbertInputs(tokenizer, ['word '.repeat(600).trim()], kind);
    assert.deepEqual(inputs.input_ids.dims, [1, limit]);
    assert.equal(inputs.input_ids.data[0], 101n);
    assert.equal(inputs.input_ids.data[limit - 1], 102n);
    const empty = colbertInputs(tokenizer, [''], kind);
    assert.equal(Array.from(empty.inputs.attention_mask.data).filter(Boolean).length, 3);
  }
});

test('ColBERT retains only scored token vectors and normalizes each separately', () => {
  const d = RETRIEVAL.dimensions;
  const values = new Float32Array(3 * d);
  values[0] = 3;
  values[1] = 4;
  values[d] = NaN; // Excluded padding must not contribute.
  values[2 * d] = -2;
  const vectors = colbertVectors(new Tensor('float32', values, [1, 3, d]), [[true, false, true]]);
  assert.equal(vectors[0]!.length, 2 * d);
  assert.ok(Math.abs(vectors[0]![0]! - 0.6) < 1e-6);
  assert.ok(Math.abs(vectors[0]![1]! - 0.8) < 1e-6);
  assert.equal(vectors[0]![d], -1);
  assert.throws(
    () => colbertVectors(new Tensor('float32', values, [1, 3, d]), [[true, true, true]]),
    /Invalid/,
  );
  assert.throws(
    () => colbertVectors(new Tensor('float32', new Float32Array(384), [1, 1, 384]), [[true]]),
    /shape/,
  );
});

test('MaxSim sums each query token’s best match, preserves negative scores and ignores document order', () => {
  const q = new Float32Array([1, 0, 0, 1]);
  assert.equal(maxSim(q, new Float32Array([1, 0, 0, 1]), 2), 2);
  assert.equal(maxSim(q, new Float32Array([0, 1, 1, 0]), 2), 2);
  assert.equal(
    maxSim(q, new Float32Array([1, 0, 1, 0]), 2),
    1,
    'Repeated document tokens do not add bonuses',
  );
  assert.equal(maxSim(new Float32Array([1, 0]), new Float32Array([-1, 0]), 2), -1);
  assert.throws(() => maxSim(q, new Float32Array(), 2), /dimensions/);
  assert.throws(() => maxSim(q, new Float32Array([1, 0, 0]), 2), /dimensions/);
  assert.throws(() => maxSim(q, new Float32Array([NaN, 0]), 2), /similarity/);
});
