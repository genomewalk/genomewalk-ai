import { parseLocalQuery } from '../src/lib/local-query.js';
import { compactMatch } from '../src/lib/match-reference.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { bgzfBytes } from './helpers/bgzf.js';
import { identifyGenome } from '../src/lib/genome-source.js';
import { LocalModelSession } from '../src/lib/local-model-session.js';
import { EmbeddingsSession } from '../src/lib/embeddings-session.js';
import { searchDocument, cosineSimilarity } from '../src/lib/semantic-search.js';
import { loadCatalogKeys, hydrateGenomewalkMatches } from '../src/lib/local-catalog.js';
import { buildEmbeddingsContext } from '../src/lib/embeddings-context.js';
import { LOCAL_MODELS, getModelProfile } from '../src/config/models/index.js';
import { scanVcf } from '../src/lib/vcf-matcher.js';
import { MatchCache } from '../src/lib/match-cache.js';
import { MATCH_CACHE } from '../src/config/match-cache.js';

const rows = [1, 2, 3, 4, 5].map((id) => ({
  citation: `C${id}`,
  rowNumber: id + 1,
  chrom: '1',
  pos: id * 10,
  ref: 'C',
  alt: 'T',
  gene: `SYNTHETIC${id}`,
  conditions: id === 1 ? 'Inherited_hearing_loss' : 'Example_condition',
  variationid: String(id),
  classification: 'Conflicting_classifications',
  conflictingclassifications: 'Uncertain_significance|Benign',
  sig: 'C',
  stars: 1,
  reviewstatus: 'criteria_provided',
  af: '0.0001',
  afmax: '0.0002',
  grp: 'sas',
  pmids: '1234,5678,9012',
  gnomadkey: `1-${id * 10}-C-T`,
  releasedate: 'PRIVATE_VERSION_SENTINEL',
  call: { gt: '0/1', alleles: ['C', 'T'], copies: 1, ploidy: 2, filter: 'PASS', dp: 30, gq: 99 },
}));
const config = {
  catalog: {
    phase: 'ready',
    sha256: 'CATALOG_HASH_SENTINEL',
    cacheKey: 'catalog-file-revision',
    rows: rows.length,
  },
  localGenome: {
    available: true,
    name: 'PRIVATE_FILENAME_SENTINEL.vcf',
    bytes: 123,
    modified: 1,
    cacheKey: 'genome-file-revision',
  },
};
const result = {
  build: 'GRCh38',
  matches: rows,
  issues: [],
  stats: { matched: rows.length, needsReview: 0 },
};
const plan = { mode: 'search', query: 'hearing loss' };
const columns = [
  'chrom',
  'pos',
  'ref',
  'alt',
  ...Object.keys(rows[0]).filter(
    (key) => !['citation', 'rowNumber', 'call', 'chrom', 'pos', 'ref', 'alt'].includes(key),
  ),
];
const header = '#' + columns.join('\t');
const dataLines = rows.map((row) => columns.map((key) => row[key]).join('\t'));
const catalogBytes = bgzfBytes([header, ...dataLines, ''].join('\n'), 130);
const metadata = {
  schema: 1,
  build: 'GRCh38',
  source: {
    size: catalogBytes.length,
    sha256: createHash('sha256').update(catalogBytes).digest('hex'),
  },
  n: rows.length,
  header,
  chromosomes: ['1'],
  sample: [],
  examples: [],
  byClass: { C: rows.length },
  byStars: { 1: rows.length },
};
// Genomewalk requires coordinate columns first; fixture order is explicit.
const preparedConfig = {
  ...config,
  catalog: {
    ...config.catalog,
    build: 'GRCh38',
    sha256: metadata.source.sha256,
    cacheKey: 'a'.repeat(64),
    lookupRevision: 'b'.repeat(64),
  },
};
const publicFetch = async (url) => {
  if (url === '/ref/GRCh38/catalog.meta.json') return Response.json(metadata);
  if (url === `/ref/GRCh38/catalog.tsv.gz?v=${metadata.source.sha256}`)
    return new Response(catalogBytes, {
      headers: { 'Content-Length': String(catalogBytes.length) },
    });
  throw new Error(`Unexpected public request: ${url}`);
};

test('cosine similarity checks vectors and search documents exclude genotypes', () => {
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.ok(cosineSimilarity([1, 0], [0.8, 0.2]) > 0.9);
  assert.throws(() => cosineSimilarity([1], [1, 2]), /dimensions/);
  assert.throws(() => cosineSimilarity([0, 0], [1, 0]), /Invalid/);
  assert.ok(!searchDocument(rows[0]).includes('0/1'));
  assert.match(searchDocument(rows[0]), /Inherited hearing loss/);
});

test('readable input preserves actual evidence and every source link without internal metadata or repeated raw fields', () => {
  const compact = compactMatch(rows[0]);
  assert.equal(
    compact.variant,
    'This variant is recorded on chromosome 1 at position 10 in the GRCh38 reference genome. The reference allele is C; the matched allele in the selected file is T.',
  );
  assert.equal(
    compact.frequency.overall,
    'The T allele accounts for 0.01% of allele copies overall in the gnomAD reference data.',
  );
  assert.deepEqual(compact.conflictingClassifications, ['Uncertain significance', 'Benign']);
  assert.equal(
    compact.yourCall,
    'The selected file contains C and T. This call has 1 copy of the ClinVar T allele. The call is heterozygous (two different alleles).',
  );
  assert.equal(compact.clinvar, '“Conflicting classifications” for the T allele.');
  assert.equal(compact.sources.ClinVar, 'https://www.ncbi.nlm.nih.gov/clinvar/variation/1/');
  assert.deepEqual(
    compact.sources.PubMed,
    ['1234', '5678', '9012'].map((id) => `https://pubmed.ncbi.nlm.nih.gov/${id}/`),
  );
  for (const field of [
    'citation',
    'rowNumber',
    'schemaVersion',
    'sourceVcfFields',
    'cloudRank',
    'catalogReleaseDate',
    'bottomLine',
    'plainLanguage',
  ])
    assert.equal(field in compact, false);
  for (const profile of LOCAL_MODELS) {
    const context = buildEmbeddingsContext(
      'Review hearing',
      [...rows].reverse(),
      result,
      profile,
      plan,
    );
    assert.equal(context.included, 3);
    assert.equal(context.evidence.matches[0].gene, 'SYNTHETIC5');
    assert.ok(context.inputBytes <= context.inputByteLimit);
    assert.ok(!JSON.stringify(context.messages).includes('SENTINEL'));
    assert.equal(
      context.messages[0].content,
      buildEmbeddingsContext('Review hearing', rows, result, LOCAL_MODELS[0], plan).messages[0]
        .content,
    );
  }
});

test('readable frequencies retain catalog decimal precision and keep missing distinct from zero', () => {
  const compact = compactMatch({
    ...rows[0],
    af: '0.019142123456789',
    afmax: '0.032405',
    grp: 'African',
  });
  assert.equal(
    compact.frequency.overall,
    'The T allele accounts for 1.9142123456789% of allele copies overall in the gnomAD reference data.',
  );
  assert.equal(
    compact.frequency.highestPopulation,
    'The highest reported population frequency is 3.2405% of allele copies in the African group.',
  );
  assert.match(
    compactMatch({ ...rows[0], af: '1e-25' }).frequency.overall,
    /0\.00000000000000000000001%/,
  );
  for (const value of [0, '0'])
    assert.match(compactMatch({ ...rows[0], af: value }).frequency.overall, / 0% /);
  assert.match(compactMatch({ ...rows[0], af: '1' }).frequency.overall, / 100% /);
  for (const value of [null, undefined, '', '.', 'NaN', -0.1, 1.1, false]) {
    const missing = compactMatch({ ...rows[0], af: value, afmax: value });
    assert.equal(missing.frequency.overall, 'Overall allele frequency is not supplied.');
    assert.equal(
      missing.frequency.highestPopulation,
      'Highest-population allele frequency is not supplied.',
    );
  }
});

test('separate source lists never become invented condition-specific classifications', () => {
  const reference = compactMatch({
    ...rows[0],
    classification: 'Likely_pathogenic|protective',
    conditions: 'Condition_A|Condition_B|Condition_C',
    conflictingclassifications: '',
  });
  assert.deepEqual(reference.conditions, ['Condition A', 'Condition B', 'Condition C']);
  assert.equal(reference.conditionClassifications, null);
  assert.equal(reference.clinvar, '“Likely pathogenic; protective” for the T allele.');
  assert.equal(Object.hasOwn(reference, 'conflictingClassifications'), false);
});

test('three-record default and explicit four-record budget share prompt, order and whole-record admission', () => {
  const profile = getModelProfile('qwen3.5-9b');
  const three = buildEmbeddingsContext('Compare', rows, result, profile, plan);
  const four = buildEmbeddingsContext('Compare', rows, result, profile, plan, [], {
    maxNewRecords: 4,
  });
  assert.equal(three.maxNewRecords, 3);
  assert.equal(three.included, 3);
  assert.equal(four.maxNewRecords, 4);
  assert.equal(four.included, 4);
  assert.deepEqual(three.evidence.matches, four.evidence.matches.slice(0, 3));
  assert.equal(three.messages[0].content, four.messages[0].content);
  assert.equal(three.omitted, 2);
  assert.equal(four.omitted, 1);
  for (const maxNewRecords of [0, 5, 2.5, '2']) {
    assert.throws(
      () => buildEmbeddingsContext('Compare', rows, result, profile, plan, [], { maxNewRecords }),
      /New-record limit/,
    );
  }
});

test('field descriptions keep calls, classification conflicts and unknown review status distinct', () => {
  const row = {
    ...rows[0],
    ref: 'AAC',
    alt: 'A',
    call: { ...rows[0].call, alleles: ['A', 'A'], copies: 2 },
    conflictingclassifications: 'Uncertain_significance_(2)|Benign_(11)|Likely_benign_(1)',
  };
  const reference = compactMatch(row);
  assert.equal(
    reference.variant,
    'This variant is recorded on chromosome 1 at position 10 in the GRCh38 reference genome. The reference allele is AAC; the matched allele in the selected file is A.',
  );
  assert.equal(
    reference.yourCall,
    'The selected file contains A and A. This call has 2 copies of the ClinVar A allele. The call is homozygous (two identical alleles).',
  );
  assert.deepEqual(reference.conflictingClassifications, [
    'Uncertain significance (2)',
    'Benign (11)',
    'Likely benign (1)',
  ]);
  assert.match(
    compactMatch({ ...row, call: { ...row.call, alleles: ['A'], copies: 1 } }).yourCall,
    /haploid call \(one called allele\)/,
  );
  const missing = compactMatch({
    ...row,
    stars: null,
    reviewstatus: '',
    classification: '',
    call: { ...row.call, alleles: null, copies: null },
  });
  assert.equal(missing.review, 'Review stars not supplied: review status not supplied.');
  assert.equal(missing.clinvar, 'Not supplied for the A allele.');
  assert.equal(
    missing.yourCall,
    'The observed alleles are not supplied. The copy count for the ClinVar A allele is not supplied. Zygosity is not established.',
  );
  assert.equal(compactMatch({ ...row, stars: 0 }).review, '0 stars: criteria provided.');
});

test('context budgeting drops whole records and retains required private referents', () => {
  const profile = getModelProfile('qwen3-4b');
  const huge = { ...rows[0], conditions: 'Condition '.repeat(5000) };
  const context = buildEmbeddingsContext('Review', [huge, ...rows.slice(1)], result, profile, plan);
  assert.equal(context.consideredRows[0].status, 'context_budget');
  assert.equal(context.included, 2);
  assert.ok(
    !context.evidence.matches.some((r) => r.gene === 'SYNTHETIC4'),
    'No backfill outside the three-record shortlist',
  );
  const previous = [
    { question: 'Verified earlier question', answer: 'UNVERIFIED_ANSWER', records: [] },
  ];
  const followup = buildEmbeddingsContext('Which one?', [], result, profile, plan, previous);
  assert.equal(followup.historyTurns, 1);
  assert.equal(followup.inputByteLimit, profile.contextWindowTokens - 4096 - 768);
  assert.equal(followup.messages[1].content, 'Verified earlier question');
  assert.ok(JSON.stringify(followup.messages).includes('UNVERIFIED_ANSWER'));
  assert.ok(!JSON.stringify(followup.recordReference).includes('UNVERIFIED_ANSWER'));
  const hugeHistory = buildEmbeddingsContext('Which?', [], result, profile, plan, [
    { question: 'x'.repeat(50000), answer: 'Old answer', records: [] },
  ]);
  assert.equal(hugeHistory.historyTurns, 0);
  assert.equal(hugeHistory.omittedHistoryTurns, 1);
});

test('local query parsing is schema validation, never heuristic repairs or keyword routing', () => {
  assert.deepEqual(parseLocalQuery(JSON.stringify(plan)), plan);
  assert.throws(() => parseLocalQuery('```json\n' + JSON.stringify(plan) + '\n```'));
  assert.throws(() => parseLocalQuery(JSON.stringify({ ...plan, cloud: true })), /invalid/);
  assert.throws(() => parseLocalQuery(JSON.stringify({ ...plan, query: '' })), /invalid/);
});

test('history keeps exact prior records and publication links across new topics, without promoting prose to evidence', () => {
  for (const profile of LOCAL_MODELS) {
    const previous = [
      {
        question: 'Hearing?',
        answer: 'Earlier answer remains verbatim.',
        records: rows.slice(0, 2).map(compactMatch),
      },
      { question: 'Explain that term', answer: 'A general definition.', records: [] },
    ];
    const c = buildEmbeddingsContext('A new topic', rows.slice(2), result, profile, plan, previous);
    assert.equal(c.historyTurns, 2);
    assert.equal(c.evidence.earlierMatches.length, 2);
    assert.deepEqual(
      c.recordReference.records.map((r) => r.gene),
      ['SYNTHETIC3', 'SYNTHETIC4', 'SYNTHETIC5', 'SYNTHETIC1', 'SYNTHETIC2'],
    );
    assert.deepEqual(
      c.messages.slice(1, -1).map((m) => m.content),
      previous.flatMap((t) => [t.question, t.answer]),
    );
    assert.ok(!JSON.stringify(c.recordReference).includes('A general definition.'));
    assert.deepEqual(
      c.evidence.earlierMatches[0].sources.PubMed,
      compactMatch(rows[0]).sources.PubMed,
    );
    assert.deepEqual(
      c.recordReference.records[3].fields
        .find((f) => f.label === 'Publications')
        .sources.map((s) => s.url),
      compactMatch(rows[0]).sources.PubMed,
    );
    assert.ok(c.inputBytes <= c.inputByteLimit);
    const repeated = buildEmbeddingsContext(
      'Same record',
      rows.slice(0, 1),
      result,
      profile,
      plan,
      previous,
    );
    assert.equal(
      repeated.recordReference.records.length,
      2,
      'Exact repeated records are deduplicated',
    );
  }
});

test('overview preserves conversation but selects only from the fresh full-pool ordering', () => {
  const previous = [
    {
      question: 'An earlier topic',
      answer: 'The earlier cards',
      records: rows.slice(0, 2).map(compactMatch),
    },
  ];
  for (const profile of LOCAL_MODELS) {
    const c = buildEmbeddingsContext(
      'Review everything',
      rows.slice(2),
      result,
      profile,
      { mode: 'overview', query: '' },
      previous,
    );
    assert.deepEqual(
      c.messages.slice(1, -1).map((m) => m.content),
      ['An earlier topic', 'The earlier cards'],
    );
    assert.deepEqual(c.evidence.earlierMatches, []);
    assert.deepEqual(
      c.recordReference.records.map((r) => r.gene),
      ['SYNTHETIC3', 'SYNTHETIC4', 'SYNTHETIC5'],
    );
    assert.ok(c.recordReference.records.every((r) => r.origin === 'current'));
  }
});

test('Genomewalk catalog bytes must pass full integrity validation before matching', async () => {
  const loaded = await loadCatalogKeys(preparedConfig, { fetchImpl: publicFetch });
  assert.equal(loaded.candidates.length, rows.length);
  assert.deepEqual(
    loaded.candidates.map((r) => r.pos),
    rows.map((r) => r.pos),
  );
  const incomplete = async (url) =>
    url.includes('.meta.json')
      ? Response.json(metadata)
      : new Response(catalogBytes.subarray(0, -4));
  await assert.rejects(loadCatalogKeys(preparedConfig, { fetchImpl: incomplete }));
  const wrongHash = { ...metadata, source: { ...metadata.source, sha256: '0'.repeat(64) } };
  await assert.rejects(
    loadCatalogKeys(
      { ...config, catalog: { ...config.catalog, sha256: wrongHash.source.sha256 } },
      {
        fetchImpl: async (url) =>
          url.includes('.meta.json') ? Response.json(wrongHash) : new Response(catalogBytes),
      },
    ),
    /does not match/,
  );
  await assert.rejects(loadCatalogKeys(config, { fetchImpl: publicFetch }), /changed/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    loadCatalogKeys(preparedConfig, { fetchImpl: publicFetch, signal: controller.signal }),
    { name: 'AbortError' },
  );
});

test('vendored download and validation modules are byte-identical to Genomewalk provenance', async () => {
  const root = new URL('../src/vendor/genomewalk/', import.meta.url);
  const provenance = JSON.parse(await readFile(new URL('provenance.json', root), 'utf8'));
  for (const [file, sha256] of Object.entries(provenance.files)) {
    assert.equal(
      createHash('sha256')
        .update(await readFile(new URL(file, root)))
        .digest('hex'),
      sha256,
      file,
    );
  }
});

test('catalog hydration preserves missing or invalid review stars as unknown, including blank cells', async () => {
  const values = ['', '.', '5', '0', '2'];
  const catalogue = {
    header: '#chrom\tpos\tref\talt\tsig\tstars',
    async *rows() {
      for (let i = 0; i < rows.length; i++) yield `1\t${rows[i].pos}\tC\tT\tC\t${values[i]}`;
    },
  };
  const hydrated = await hydrateGenomewalkMatches(result, catalogue);
  const byPosition = new Map(hydrated.matches.map((r) => [r.pos, r.stars]));
  assert.deepEqual(
    rows.map((r) => byPosition.get(r.pos)),
    [null, null, null, 0, 2],
  );
});

test('local mode uses real matching, isolated history and compact requests; no cloud endpoint is reachable', async () => {
  const requests = [];
  const urls = [];
  const operations = [];
  let scans = 0;
  let malformed = false;
  let mode = 'search';
  const engine = {
    dispose() {},
    async reset() {},
    async *complete(request) {
      requests.push(structuredClone(request));
      const content = !request.response_format
        ? 'These records contain the requested annotations.'
        : JSON.parse(request.response_format.schema).anyOf?.some(
              (branch) => branch.properties?.mode,
            )
          ? malformed
            ? 'invalid JSON'
            : JSON.stringify({ ...plan, mode, query: mode === 'search' ? plan.query : '' })
          : JSON.stringify({ selected: ['v1'] });
      yield { choices: [{ delta: { content }, finish_reason: 'stop' }] };
      yield { choices: [], usage: { prompt_tokens: 400, completion_tokens: 10 } };
    },
  };
  const local = new LocalModelSession({
    modelId: 'qwen3-4b',
    checkSupport: async () => 'test',
    createEngine: async () => engine,
  });
  await local.initialize();
  const vcf =
    '##fileformat=VCFv4.2\n##reference=GRCh38\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tPRIVATE_SAMPLE\n' +
    rows.map((r) => `1\t${r.pos}\t.\tC\tT\t99\tPASS\t.\tGT\t0/1\n`).join('');
  const search = {
    dispose() {},
    async call(operation, payload) {
      operations.push(operation);
      if (operation === 'index') {
        assert.ok(payload.documents.every((s) => !s.includes('PRIVATE') && !s.includes('0/1')));
        return { count: payload.documents.length, dimensions: 384 };
      }
      if (operation === 'score')
        return rows.map((r, index) => ({ index, similarity: 1 / (index + 1) }));
      throw new Error(`Unexpected search operation: ${operation}`);
    },
  };
  const session = new EmbeddingsSession({
    local,
    search,
    matcher: async ({ candidates }) => {
      scans++;
      return scanVcf({
        candidates,
        chunks: (async function* () {
          yield Buffer.from(vcf);
        })(),
      });
    },
    fetchImpl: async (url) => {
      urls.push(url);
      if (url === '/ref/release.json')
        return Response.json({ schema: 1, catalogs: { GRCh38: preparedConfig.catalog } });
      if (url.startsWith('/ref/GRCh38/')) return publicFetch(url);
      throw new Error(`Forbidden endpoint: ${url}`);
    },
  });
  await session.initialize();
  assert.equal(session.state.phase, 'ready');
  assert.deepEqual(operations, ['index']);
  await session.send('Hearing?');
  assert.equal(session.state.error, null);
  const first = session.state.messages.at(-1);
  assert.equal(first.status, 'complete');
  assert.equal(first.context.evidence.matches[0].gene, 'SYNTHETIC1');
  assert.equal(first.context.included, 3);
  assert.equal(first.finishReason, 'stop');
  assert.equal(first.question, 'Hearing?');
  assert.deepEqual(
    first.journey.steps.find((s) => s.id === 'query').data.request,
    requests[0],
    'The completed planning trace retains the actual local request',
  );
  assert.deepEqual(
    first.journey.steps.find((s) => s.id === 'context').data.request,
    requests[1],
    'The answer trace retains the actual submitted request',
  );
  assert.deepEqual(
    requests[0].extra_body,
    {},
    'Constrained JSON must not receive a runtime thinking prefix',
  );
  assert.deepEqual(
    requests[1].extra_body,
    {},
    'Fact selection must not receive a runtime thinking prefix',
  );
  assert.deepEqual(
    first.journey.steps.find((s) => s.id === 'answer').data.opening.request,
    requests[2],
  );
  assert.deepEqual(requests[2].extra_body, { enable_thinking: false });
  assert.ok(first.evidenceAnswer);
  assert.match(first.content, /SYNTHETIC1/);
  assert.equal(
    first.journey.steps.find((s) => s.id === 'answer').data.raw,
    JSON.stringify({ selected: ['v1'] }),
  );
  assert.equal(first.journey.steps.find((s) => s.id === 'semantic').data.rows.length, 5);
  assert.equal(
    first.journey.steps.some((s) => s.id === 'ranking'),
    false,
  );
  assert.equal(
    first.journey.steps.find((s) => s.id === 'semantic').data.scores.length,
    rows.length,
  );
  assert.deepEqual(first.journey.steps.find((s) => s.id === 'semantic').data.rows[0].priority, {
    sig: 'C',
    classValue: 0.5,
    classification: 'Conflicting classifications',
    classificationOrder: 2,
    reviewStars: 1,
  });
  assert.ok(
    !JSON.stringify(requests).includes('classificationOrder'),
    'Sorting metadata stays in the journey, outside LLM context',
  );
  assert.equal(first.journey.steps.find((s) => s.id === 'context').data.submitted, true);
  assert.ok(!JSON.stringify(requests).includes('SENTINEL'));
  await session.send('Which of those?');
  assert.equal(session.state.error, null);
  assert.equal(scans, 1);
  assert.equal(session.state.messages.at(-1).context.historyTurns, 1);
  assert.deepEqual(
    operations,
    ['index', 'score', 'score'],
    'Search uses only embedding/index operations; catalog ordering runs in the session',
  );
  assert.ok(urls.every((url) => url === '/ref/release.json' || url.startsWith('/ref/GRCh38/')));
  assert.equal(local.state.reserved, false);
  assert.equal('history' in local, false);
  malformed = true;
  await session.send('A failed plan');
  assert.equal(session.state.messages.at(-1).status, 'error');
  assert.equal(session.history.length, 2);
  assert.equal(session.state.indexReady, true);
  assert.equal(local.state.reserved, false);
  malformed = false;
  await session.send('Try again');
  assert.equal(session.state.messages.at(-1).status, 'complete');
  assert.equal(scans, 1);
  const operationCount = operations.length;
  mode = 'overview';
  await session.send('Overview');
  assert.equal(session.state.error, null);
  assert.equal(scans, 1);
  assert.equal(operations.length, operationCount);
  assert.equal(
    session.state.messages.at(-1).journey.steps.find((s) => s.id === 'semantic').data.mode,
    'overview',
  );
  assert.deepEqual(
    session.state.messages.at(-1).context.evidence.matches.map((r) => r.gene),
    rows.slice(0, 3).map((r) => r.gene),
  );
  session.forget();
  assert.equal(session.state.indexReady, false);
  assert.equal(session.history.length, 0);
});

test('cancellation discards provisional matching and frees the UI without creating private history', async () => {
  let started;
  const scanning = new Promise((resolve) => {
    started = resolve;
  });
  const session = new EmbeddingsSession({
    local: new LocalModelSession(),
    fetchImpl: (url) =>
      url === '/ref/release.json'
        ? Promise.resolve(
            Response.json({ schema: 1, catalogs: { GRCh38: preparedConfig.catalog } }),
          )
        : publicFetch(url),
    matcher: ({ signal }) =>
      new Promise((resolve, reject) => {
        started();
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    search: {
      dispose() {},
      call() {
        throw new Error('Must not embed an incomplete scan');
      },
    },
  });
  const pending = session.initialize();
  await scanning;
  session.stop();
  await pending;
  assert.equal(session.state.busy, false);
  assert.equal(session.state.error, null);
  assert.equal(session.state.indexReady, false);
  assert.equal(session.history.length, 0);
});

test('a fresh session does no work until a genome is selected', async () => {
  let requests = 0;
  let scans = 0;
  let indexes = 0;
  const local = new LocalModelSession();
  const session = new EmbeddingsSession({
    local,
    fetchImpl: (url) => {
      requests++;
      return url === '/ref/release.json'
        ? Promise.resolve(
            Response.json({ schema: 1, catalogs: { GRCh38: preparedConfig.catalog } }),
          )
        : publicFetch(url);
    },
    matcher: async () => {
      scans++;
      return structuredClone(result);
    },
    search: {
      dispose() {},
      async call(op, payload) {
        assert.equal(op, 'index');
        indexes++;
        return { count: payload.documents.length, dimensions: 384 };
      },
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.getSnapshot().phase, 'idle');
  assert.equal(session.getSnapshot().indexReady, false);
  assert.deepEqual([requests, scans, indexes], [0, 0, 0]);
  await session.selectGenome(null);
  assert.equal(session.getSnapshot().indexReady, true);
  assert.equal(scans, 1);
  assert.equal(indexes, 1);
  assert.equal(local.getSnapshot().phase, 'unselected');
  session.dispose();
});

test('explicit preparation is idempotent and does not select or load an answer model', async () => {
  const local = new LocalModelSession();
  let scans = 0;
  let indexes = 0;
  const session = new EmbeddingsSession({
    local,
    fetchImpl: (url) =>
      url === '/ref/release.json'
        ? Promise.resolve(
            Response.json({ schema: 1, catalogs: { GRCh38: preparedConfig.catalog } }),
          )
        : publicFetch(url),
    matcher: async () => {
      scans++;
      return structuredClone(result);
    },
    search: {
      dispose() {},
      async call(op, payload) {
        assert.equal(op, 'index');
        indexes++;
        return { count: payload.documents.length, dimensions: 384 };
      },
    },
  });
  await Promise.all([session.initialize(), session.initialize()]);
  assert.equal(session.state.error, null);
  assert.equal(session.state.indexReady, true);
  assert.equal(local.state.phase, 'unselected');
  assert.equal(await session.send('Before choosing'), false);
  assert.equal(scans, 1);
  assert.equal(indexes, 1);
  assert.ok(
    session.state.preparationJourney.steps.slice(0, 3).every((step) => step.status === 'complete'),
  );
  session.clear();
  await session.initialize();
  assert.equal(scans, 1);
  assert.equal(indexes, 1);
});

test('refresh restores verified matches without catalog downloads or genome scanning; forgetting removes saved data', async () => {
  const values = new Map();
  const storage = {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
  const cache = new MatchCache(() => storage);
  const ops = [];
  let scans = 0;
  let embeddingFails = true;
  const search = {
    dispose() {},
    async call(op, payload) {
      ops.push(op);
      if (embeddingFails) throw new Error('Synthetic embedding failure');
      return { count: payload.documents.length, dimensions: 384 };
    },
  };
  const local = new LocalModelSession();
  const cold = new EmbeddingsSession({
    local,
    search,
    matchCache: cache,
    fetchImpl: (url) =>
      url === '/ref/release.json'
        ? Promise.resolve(
            Response.json({ schema: 1, catalogs: { GRCh38: preparedConfig.catalog } }),
          )
        : publicFetch(url),
    matcher: async () => {
      scans++;
      return { ...structuredClone(result), limitations: 'Synthetic exact matching.' };
    },
  });
  await cold.initialize();
  assert.equal(cold.state.indexReady, false);
  assert.match(cold.state.error.message, /embedding failure/);
  assert.equal(
    cold.state.matchCacheInfo.status,
    'saved',
    'Complete matching remains reusable even if embedding fails',
  );
  assert.equal(scans, 1);
  assert.ok(storage.getItem(MATCH_CACHE.key));
  cold.dispose();
  embeddingFails = false;
  const restored = new EmbeddingsSession({
    local: new LocalModelSession(),
    search,
    matchCache: new MatchCache(() => storage),
    fetchImpl: async (url) => {
      assert.equal(
        url,
        '/ref/release.json',
        'A cache hit cannot request catalog, genome or cloud endpoints',
      );
      return Response.json({ schema: 1, catalogs: { GRCh38: preparedConfig.catalog } });
    },
    matcher: () => {
      throw new Error('Unexpected genome scan');
    },
  });
  await restored.initialize();
  assert.equal(restored.state.matchCacheInfo.count, rows.length);
  assert.equal(restored.local.state.phase, 'unselected');
  assert.equal(ops.length, 2, 'Explicit preparation rebuilds embeddings, but no answer model');
  await restored.prepare();
  assert.equal(restored.state.error, null);
  assert.equal(restored.state.indexReady, true);
  assert.equal(restored.state.matchCacheInfo.status, 'restored');
  assert.equal(scans, 1);
  assert.deepEqual(
    restored.prepared.result.matches.map((r) => r.call),
    rows.map((r) => r.call),
  );
  assert.deepEqual(ops, ['index', 'index'], 'Only embeddings rebuild after refresh');
  assert.ok(!storage.getItem(MATCH_CACHE.key).includes('PRIVATE_FILENAME_SENTINEL'));
  restored.clear();
  assert.ok(storage.getItem(MATCH_CACHE.key), 'Clear chat keeps reusable matches');
  restored.forget();
  assert.equal(storage.getItem(MATCH_CACHE.key), null);
  assert.equal(restored.state.indexReady, false);
});

test('failed or canceled matching and source changes never publish a saved result', async () => {
  for (const outcome of ['fail', 'abort', 'changed']) {
    const values = new Map();
    const cache = new MatchCache(() => ({
      getItem: (k) => values.get(k) ?? null,
      setItem: (k, v) => values.set(k, v),
      removeItem: (k) => values.delete(k),
    }));
    let configReads = 0;
    const session = new EmbeddingsSession({
      local: new LocalModelSession(),
      matchCache: cache,
      fetchImpl: async (url) => {
        if (url !== '/ref/release.json') return publicFetch(url);
        configReads++;
        return Response.json({
          schema: 1,
          catalogs: {
            GRCh38: {
              ...preparedConfig.catalog,
              ...(outcome === 'changed' && configReads > 1 ? { cacheKey: 'c'.repeat(64) } : {}),
            },
          },
        });
      },
      matcher: async () => {
        if (outcome === 'fail') throw new Error('Synthetic scan failed');
        if (outcome === 'abort') session.stop();
        return { ...structuredClone(result), limitations: 'Synthetic exact matching.' };
      },
      search: {
        dispose() {},
        call() {
          throw new Error('Embedding must not start');
        },
      },
    });
    await session.initialize();
    assert.equal(values.size, 0, outcome);
    assert.equal(session.state.indexReady, false);
    if (outcome === 'changed') assert.match(session.state.error.message, /changed during matching/);
  }
});

const inputFile = (name = 'synthetic.vcf') =>
  new File(
    [
      '##fileformat=VCFv4.2\n##reference=GRCh38\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC\n1\t10\t.\tC\tT\t99\tPASS\t.\tGT\t0/1\n',
    ],
    name,
  );
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const preparationFetch = (url) =>
  url === '/ref/release.json'
    ? Promise.resolve(Response.json({ schema: 1, catalogs: { GRCh38: preparedConfig.catalog } }))
    : publicFetch(url);

test('changing genome cancels in-flight preparation, rejects late results and clears previous conversation evidence', async () => {
  const firstStarted = deferred();
  const firstResult = deferred();
  const indexed = [];
  const writes = [];
  let scans = 0;
  const session = new EmbeddingsSession({
    identify: identifyGenome,
    fetchImpl: preparationFetch,
    matchCache: {
      read: () => ({ entry: null, info: {} }),
      write(key, value) {
        writes.push(value);
        return {};
      },
    },
    matcher: async ({ file, signal }) => {
      scans++;
      if (!file) {
        firstStarted.resolve(signal);
        return firstResult.promise;
      } // Deliberately ignores cancellation.
      return {
        ...structuredClone(result),
        matches: rows.slice(0, 1),
        stats: { matched: 1, needsReview: 0 },
      };
    },
    search: {
      dispose() {},
      async call(op, payload) {
        indexed.push(payload.documents);
        return { count: payload.documents.length, dimensions: 384 };
      },
    },
  });
  const initial = session.initialize();
  const signal = await firstStarted.promise;
  session.history = [
    { question: 'Old genome question', answer: 'Old answer', records: rows.map(compactMatch) },
  ];
  session.update({ messages: [{ role: 'assistant', content: 'Old genome answer' }] });
  const switched = session.selectGenome(inputFile());
  assert.equal(signal.aborted, true);
  firstResult.resolve(structuredClone(result));
  await initial;
  await switched;
  assert.equal(session.state.error, null);
  assert.equal(session.state.genome.kind, 'upload');
  assert.equal(session.state.matchCount, 1);
  assert.equal(scans, 2);
  assert.equal(writes.length, 1, 'Canceled sample matching cannot publish into the cache');
  assert.equal(indexed.length, 1, 'Canceled sample matching cannot enter the search index');
  assert.equal(indexed[0].length, 1);
  assert.deepEqual(session.history, []);
  assert.deepEqual(session.state.messages, []);
  assert.equal(session.local.state.phase, 'unselected');
});

test('rapid file selections keep only the last choice, and choosing the public example removes the File reference', async () => {
  const started = deferred();
  const late = deferred();
  const seen = [];
  const session = new EmbeddingsSession({
    fetchImpl: preparationFetch,
    identify: async (file, options) => {
      if (file.name === 'first.vcf') {
        started.resolve(options.signal);
        return late.promise;
      }
      return identifyGenome(file, options);
    },
    matcher: async ({ file }) => {
      seen.push(file?.name ?? 'example');
      return structuredClone(result);
    },
    search: {
      dispose() {},
      async call(op, payload) {
        return { count: payload.documents.length, dimensions: 384 };
      },
    },
  });
  const firstFile = inputFile('first.vcf');
  const first = session.selectGenome(firstFile);
  const signal = await started.promise;
  const second = session.selectGenome(inputFile('second.vcf'));
  const third = session.selectGenome(inputFile('third.vcf'));
  assert.equal(signal.aborted, true);
  late.resolve(await identifyGenome(firstFile));
  assert.deepEqual(await Promise.all([first, second, third]), [false, false, true]);
  assert.equal(session.state.genome.name, 'third.vcf');
  assert.deepEqual(seen, ['third.vcf']);
  await session.selectGenome();
  assert.equal(session.file, null);
  assert.equal(session.state.genome.kind, 'example');
  assert.deepEqual(seen, ['third.vcf', 'example']);
});

test('a failed public example can be replaced with a valid upload; invalid files never retain earlier evidence', async () => {
  const session = new EmbeddingsSession({
    identify: identifyGenome,
    fetchImpl: preparationFetch,
    matcher: async ({ file }) => {
      if (!file) throw new Error('Example unavailable');
      return structuredClone(result);
    },
    search: {
      dispose() {},
      async call(op, payload) {
        return { count: payload.documents.length, dimensions: 384 };
      },
    },
  });
  await session.initialize();
  assert.match(session.state.error.message, /Example unavailable/);
  await session.selectGenome(inputFile());
  assert.equal(session.state.error, null);
  assert.equal(session.state.indexReady, true);
  session.history = [{ question: 'Old', answer: 'Old', records: rows.map(compactMatch) }];
  session.update({ messages: [{ content: 'Earlier evidence' }] });
  await session.selectGenome(new File(['not a VCF'], 'invalid.vcf'));
  assert.equal(session.state.indexReady, false);
  assert.equal(session.prepared, null);
  assert.equal(session.state.phase, 'error');
  assert.deepEqual(session.history, []);
  assert.deepEqual(session.state.messages, []);
});
