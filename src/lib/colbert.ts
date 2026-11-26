import { Tensor } from '@huggingface/transformers';
import type { PreTrainedTokenizer } from '@huggingface/transformers';
import { RETRIEVAL } from '../config/embeddings.ts';

// Checkpoint defaults from answerdotai/answerai-colbert-small-v1/artifact.metadata.
// Matches Sentence Transformers' MultiVectorEncoder: query expansion, document
// punctuation masking, normalized token vectors and sum-of-maxima scoring.
const punctuation = Array.from('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~');
type Tokenizer = Pick<PreTrainedTokenizer, 'encode' | 'convert_tokens_to_ids'>;

export function colbertInputs(tokenizer: Tokenizer, texts: string[], kind: 'query' | 'document') {
  const query = kind === 'query';
  const limit = query ? RETRIEVAL.queryTokens : RETRIEVAL.documentTokens;
  const marker = tokenizer.convert_tokens_to_ids(query ? '[unused0]' : '[unused1]');
  const cls = tokenizer.convert_tokens_to_ids('[CLS]');
  const sep = tokenizer.convert_tokens_to_ids('[SEP]');
  const pad = tokenizer.convert_tokens_to_ids(query ? '[MASK]' : '[PAD]');
  const rows = texts.map((text) => [
    cls,
    marker,
    ...tokenizer.encode(text, { add_special_tokens: false }).slice(0, limit - 3),
    sep,
  ]);
  const width = query ? limit : Math.max(0, ...rows.map((row) => row.length));
  const shape = [rows.length, width];
  const ids = new BigInt64Array(rows.length * width);
  const attention = new BigInt64Array(ids.length);
  const skip = new Set(tokenizer.convert_tokens_to_ids(punctuation));
  const masks = rows.map((row, batch) =>
    Array.from({ length: width }, (_, column) => {
      const real = column < row.length;
      const id = real ? row[column]! : pad;
      ids[batch * width + column] = BigInt(id);
      attention[batch * width + column] = real ? 1n : 0n;
      // Expansion tokens are not attended to, but DO contribute to query scoring.
      return query || (real && !skip.has(id));
    }),
  );
  return {
    inputs: {
      input_ids: new Tensor('int64', ids, shape),
      attention_mask: new Tensor('int64', attention, shape),
      token_type_ids: new Tensor('int64', new BigInt64Array(ids.length), shape),
    },
    masks,
  };
}

export function colbertVectors(output: Tensor, masks: boolean[][]): Float32Array[] {
  const [batch, width, dimensions] = output.dims;
  if (
    output.type !== 'float32' ||
    output.dims.length !== 3 ||
    batch !== masks.length ||
    dimensions !== RETRIEVAL.dimensions ||
    masks.some((mask) => mask.length !== width)
  )
    throw new Error('Unexpected ColBERT token embedding shape.');
  const data = output.data as Float32Array;
  return masks.map((mask, row) => {
    const vectors = new Float32Array(mask.filter(Boolean).length * dimensions);
    let offset = 0;
    for (let token = 0; token < mask.length; token++) {
      if (!mask[token]) continue;
      const start = (row * width! + token) * dimensions;
      let norm = 0;
      for (let d = 0; d < dimensions; d++) norm += data[start + d]! ** 2;
      if (!Number.isFinite(norm) || norm === 0) throw new Error('Invalid ColBERT token vector.');
      norm = Math.sqrt(norm);
      for (let d = 0; d < dimensions; d++) vectors[offset++] = data[start + d]! / norm;
    }
    return vectors;
  });
}

// Inputs are packed, normalized token vectors with masked tokens already removed.
export function maxSim(query: Float32Array, document: Float32Array, dimensions: number) {
  if (
    !query.length ||
    !document.length ||
    dimensions < 1 ||
    query.length % dimensions ||
    document.length % dimensions
  )
    throw new Error('Invalid ColBERT vector dimensions.');
  let score = 0;
  for (let q = 0; q < query.length; q += dimensions) {
    let best = -Infinity;
    for (let d = 0; d < document.length; d += dimensions) {
      let dot = 0;
      for (let k = 0; k < dimensions; k++) dot += query[q + k]! * document[d + k]!;
      best = Math.max(best, dot);
    }
    score += best;
  }
  if (!Number.isFinite(score)) throw new Error('Invalid ColBERT similarity.');
  return score;
}
