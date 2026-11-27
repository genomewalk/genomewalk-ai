import type {
  MatchedRow,
  MatchResult,
  ModelProfile,
  ReferenceRecord,
  SearchPlan,
} from './types.ts';
import { compactMatch } from './match-reference.ts';
import { buildCatalogSummary } from './catalog-summary.ts';
import { ANSWER_PROMPT } from '../prompts/answer.ts';
import { recordLimit, EVIDENCE_ANSWER } from '../config/evidence-answer.ts';
import { fitConversation } from './conversation-context.ts';
import type { ConversationTurn } from './conversation-context.ts';
import { buildReferenceRecord, buildAnswerReference } from './evidence-answer.ts';
import type { PublicationLabels } from '../vendor/genomewalk/catalogues/publication-format.ts';

export function buildEmbeddingsContext(
  question: string,
  rows: MatchedRow[],
  result: Pick<MatchResult, 'build' | 'matches' | 'issues'>,
  profile: ModelProfile,
  plan: SearchPlan,
  {
    maxNewRecords = recordLimit(plan),
    publicationLabels,
    history = [],
    summary = buildCatalogSummary(result.matches),
  }: {
    maxNewRecords?: number;
    publicationLabels?: PublicationLabels;
    history?: ConversationTurn[];
    summary?: string;
  } = {},
) {
  const limit = recordLimit(plan);
  if (!Number.isInteger(maxNewRecords) || maxNewRecords < 1 || maxNewRecords > limit)
    throw new Error(`New-record limit must be an integer from 1 to ${limit}.`);
  const matches: ReturnType<typeof compactMatch>[] = [];
  const records: ReferenceRecord[] = [];
  const consideredRows: { citation: string; gene?: string; status: string }[] = [];
  const fit = (candidates: ReferenceRecord[], turns: ConversationTurn[]) =>
    fitConversation(turns, profile, {
      system: ANSWER_PROMPT,
      question: [
        `Matched variant records:\n${JSON.stringify(buildAnswerReference({ records: candidates }).records)}`,
        summary,
        plan.query ? `Search topic: ${plan.query}` : 'Record order: catalog review priority.',
        `Question: ${question}`,
      ].join('\n\n'),
      generation: { max_tokens: EVIDENCE_ANSWER.maxTokens },
    });

  // Give complete records priority over conversation history.
  for (const row of rows.slice(0, maxNewRecords)) {
    const match = compactMatch(row);
    let status = 'included';
    try {
      const record = buildReferenceRecord(match, `v${records.length + 1}`, publicationLabels);
      fit([...records, record], []);
      records.push(record);
      matches.push(match);
    } catch {
      status = 'context_budget';
    }
    consideredRows.push({ citation: row.citation, gene: row.gene, status });
  }

  return {
    ...fit(records, history),
    recordReference: { records },
    evidence: {
      build: result.build ?? 'GRCh38',
      coverage: {
        catalogMatches: result.matches.length,
        unresolvedCalls: result.issues.length,
        currentTurn: {
          retrieval: plan.query ? 'semantic_search' : 'catalog_review',
          retrievedCandidates: rows.length,
          included: matches.length,
          omittedFromShortlist: rows.length - matches.length,
        },
      },
      note: 'Only selected exact matches in this curated catalog are included. Inheritance, phase across variants and personal prognosis have not been assessed. Publications are links only.',
      matches,
    },
    included: matches.length,
    omitted: rows.length - matches.length,
    maxNewRecords,
    consideredRows,
  };
}
