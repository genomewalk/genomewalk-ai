import type { ChatMessage, JourneyStep } from '../lib/session-types.ts';
import { Disclosure, RawText, Stats } from './StepDetails.tsx';
import { RequestDiagram } from './RequestDiagram.tsx';
import { recordLimit } from '../config/evidence-answer.ts';

export function RetrievalDetail({ message, step }: { message: ChatMessage; step: JourneyStep }) {
  const data = step.data;
  const context = message.context;
  const plan = message.journey?.steps.find((item) => item.id === 'query')?.data?.response;
  const considered = new Map(
    context?.consideredRows?.map((row) => [row.citation, row.status]) ?? [],
  );
  const limit = context?.maxNewRecords ?? recordLimit(plan);
  return (
    <>
      <p className="step-description">
        {plan?.overview
          ? 'The overview uses the same review priority as the catalog summary.'
          : 'The local embedding model orders matched variants by similarity to the search query.'}{' '}
        Up to {limit} new records are prepared for the answer, as space allows. This order helps
        choose records to review; it does not measure personal risk.
      </p>
      {data?.rows && (
        <>
          <Stats
            items={[
              [
                plan?.overview ? 'Ordering' : 'Search topic',
                data.query ?? 'Catalog review priority',
              ],
              ['Matches considered', data.total?.toLocaleString() ?? '—'],
              ['Records for the answer', `Up to ${limit}`],
            ]}
          />
          <h3>{plan?.overview ? 'Matches in catalog review order' : 'Matches in search order'}</h3>
          <p className="step-footnote">
            First {data.rows.length} of {data.total?.toLocaleString()}. Open a row to inspect its
            record.
          </p>
          <ol className="match-list">
            {data.rows.map((hit) => {
              const row = message.result!.matches[hit.index]!;
              const status = considered.get(row.citation);
              const label = !context
                ? ''
                : status === 'included'
                  ? context.submitted
                    ? 'Sent to model'
                    : 'Ready'
                  : status === 'context_budget'
                    ? 'No room'
                    : '';
              const { record } = hit;
              const stars = hit.priority.reviewStars;
              return (
                <li key={hit.index} className={status === 'included' ? 'is-included' : ''}>
                  <span className="match-rank">{hit.rank}</span>
                  <Disclosure
                    title={
                      <>
                        <strong>{record.gene || 'Unnamed gene'}</strong>
                        {record.sources.dbSNP?.[0] && ` · ${record.sources.dbSNP[0].label}`}
                        <small>
                          {record.conditions[0] ?? 'No listed condition'} ·{' '}
                          {hit.priority.classification} ·{' '}
                          {stars == null
                            ? 'review status unknown'
                            : `${stars} ${stars === 1 ? 'star' : 'stars'}`}
                        </small>
                      </>
                    }
                    note={
                      <>
                        {hit.similarity != null && (
                          <span title="Similarity score">{hit.similarity.toFixed(2)}</span>
                        )}
                        {label && <span className="match-badge">{label}</span>}
                      </>
                    }
                  >
                    <p>{record.variant}</p>
                    <p>{record.yourCall}</p>
                    {record.conditions.length > 1 && <p>{record.conditions.join('; ')}</p>}
                    <RawText label="Text used for search">{hit.searchText}</RawText>
                  </Disclosure>
                </li>
              );
            })}
          </ol>
        </>
      )}
      <h3>Where this step fits</h3>
      <RequestDiagram message={message} selected={1} />
    </>
  );
}
