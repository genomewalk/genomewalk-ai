import { compactMatch } from './match-reference.js';
import { EMBEDDINGS_ANSWER_PROMPT } from '../prompts/embeddings.js';
import { MAX_RECORDS } from '../config/evidence-answer.js';
import { conversationMessages, fitConversation } from './conversation-context.js';
import { buildRecordReference, selectionGeneration } from './evidence-answer.js';
import { genomeProvenance } from './genome-provenance.js';

export function buildEmbeddingsContext(
  question,
  rows,
  result,
  profile,
  plan,
  previous = [],
  { maxNewRecords = MAX_RECORDS, maxSelectedRecords, genomeSource } = {},
) {
  if (!Number.isInteger(maxNewRecords) || maxNewRecords < 1 || maxNewRecords > 4)
    throw new Error('New-record limit must be an integer from 1 to 4.');
  const matches = [],
    consideredRows = [];
  const build = (history) => {
    const seen = new Set(matches.map((match) => JSON.stringify(match))),
      earlierMatches = [];
    // Topic follow-ups can select earlier displayed records. An overview uses
    // only the fresh full-pool ordering; history still supplies conversation.
    for (const turn of plan.mode === 'search' ? history : [])
      for (const match of turn.records ?? []) {
        const key = JSON.stringify(match);
        if (!seen.has(key)) {
          seen.add(key);
          earlierMatches.push(match);
        }
      }
    const evidence = {
      build: result.build ?? 'GRCh38',
      review: plan.mode,
      genomeSource: genomeProvenance(genomeSource),
      coverage: {
        catalogMatches: result.matches.length,
        unresolvedCalls: result.issues.length,
        currentTurn: {
          retrieval: plan.mode === 'overview' ? 'catalog_overview' : 'semantic_search',
          retrievedCandidates: rows.length,
          included: matches.length,
          omittedFromShortlist: rows.length - matches.length,
        },
        earlierRecordsIncluded: earlierMatches.length,
      },
      note: 'Only selected exact matches in this curated catalog are included. Inheritance, phase across variants and personal prognosis have not been assessed. Publications are links only.',
      matches: [...matches],
      earlierMatches,
    };
    const recordReference = buildRecordReference(evidence, { maxSelectedRecords });
    return {
      evidence,
      recordReference,
      generation: selectionGeneration(recordReference),
      messages: conversationMessages(
        EMBEDDINGS_ANSWER_PROMPT,
        JSON.stringify({ scope: plan, reference: recordReference, latestQuestion: question }),
        history,
      ),
    };
  };
  // Reserve the current question and configured new-record allowance before history.
  fitConversation([], profile, build);
  for (const row of rows.slice(0, maxNewRecords)) {
    matches.push(compactMatch(row));
    let status = 'included';
    try {
      fitConversation([], profile, build);
    } catch {
      matches.pop();
      status = 'context_budget';
    }
    consideredRows.push({ citation: row.citation, gene: row.gene, status });
  }
  return {
    ...fitConversation(previous, profile, build),
    included: matches.length,
    omitted: rows.length - matches.length,
    maxNewRecords,
    consideredRows,
  };
}
