import type { MatchedRow, MatchResult, ModelProfile, SearchPlan, GenomeSource } from './types.ts';
import { compactMatch } from './match-reference.ts';
import { EMBEDDINGS_ANSWER_PROMPT } from '../prompts/embeddings.ts';
import { MAX_CANDIDATES, EVIDENCE_ANSWER } from '../config/evidence-answer.ts';
import { conversationMessages, fitConversation } from './conversation-context.ts';
import { buildRecordReference, buildAnswerReference } from './evidence-answer.ts';
import { genomeProvenance } from './genome-provenance.ts';
import type { PublicationLabels } from '../vendor/genomewalk/catalogues/publication-format.ts';

export function buildEmbeddingsContext(
  question: string,
  rows: MatchedRow[],
  result: Pick<MatchResult, 'build' | 'matches' | 'issues'>,
  profile: ModelProfile,
  plan: SearchPlan,
  {
    maxNewRecords = MAX_CANDIDATES,
    genomeSource,
    publicationLabels,
  }: {
    maxNewRecords?: number;
    genomeSource?: GenomeSource;
    publicationLabels?: PublicationLabels;
  } = {},
) {
  if (!Number.isInteger(maxNewRecords) || maxNewRecords < 1 || maxNewRecords > MAX_CANDIDATES)
    throw new Error(`New-record limit must be an integer from 1 to ${MAX_CANDIDATES}.`);
  const matches: ReturnType<typeof compactMatch>[] = [];
  const consideredRows: { citation: string; gene?: string; status: string }[] = [];
  const build = () => {
    const earlierMatches: ReturnType<typeof compactMatch>[] = [];
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
    const recordReference = buildRecordReference({ ...evidence, publicationLabels });
    return {
      evidence,
      recordReference,
      generation: {
        max_tokens: EVIDENCE_ANSWER.maxTokens,
        presence_penalty: 0,
        repetition_penalty: 1,
      },
      messages: conversationMessages(
        EMBEDDINGS_ANSWER_PROMPT,
        JSON.stringify({
          scope: plan,
          reference: buildAnswerReference(recordReference),
          latestQuestion: question,
        }),
        [],
      ),
    };
  };
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
    ...fitConversation([], profile, build),
    included: matches.length,
    omitted: rows.length - matches.length,
    maxNewRecords,
    consideredRows,
  };
}
