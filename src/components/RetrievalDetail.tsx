import type { ChatMessage, JourneyStep } from '../lib/session-types.ts';
import { Disclosure } from './StepDetails.tsx';
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
      <RequestDiagram message={message} selected={1} />
      {data?.rows && (
        <>
          {data.query && (
            <p>
              <strong>Searching for:</strong> {data.query}
            </p>
          )}
          <h3>{plan?.overview ? 'Matches in catalog review order' : 'Matches in search order'}</h3>
          <p>
            Showing the first {data.rows.length} of {data.total?.toLocaleString()} matches. Expand a
            gene to inspect its record.
          </p>
          <div
            className="local-table-scroll"
            role="region"
            aria-label="Ordered matches"
            tabIndex={0}
          >
            <table className="local-stage-table">
              <colgroup>
                <col className="rank-column" />
                <col />
                <col className="status-column" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Matched variant</th>
                  <th scope="col">Model input</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((hit) => {
                  const row = message.result!.matches[hit.index]!;
                  const status = considered.get(row.citation);
                  const label = !context
                    ? 'Waiting'
                    : status === 'included'
                      ? context.submitted
                        ? 'Included'
                        : 'Ready'
                      : status === 'context_budget'
                        ? 'No room'
                        : 'Not included';
                  return (
                    <tr key={hit.index} className={status === 'included' ? 'is-included' : ''}>
                      <td>{hit.rank}</td>
                      <td>
                        <Disclosure title={<strong>{hit.record.gene || 'Unnamed gene'}</strong>}>
                          <p>{hit.record.variant}</p>
                          <p>{hit.record.yourCall}</p>
                          <p>{hit.record.conditions.join('; ')}</p>
                        </Disclosure>
                        <span className="local-record-caption">
                          {hit.priority.classification} ·{' '}
                          {hit.priority.reviewStars == null
                            ? 'Review status unknown'
                            : `${hit.priority.reviewStars} ${hit.priority.reviewStars === 1 ? 'star' : 'stars'}`}
                        </span>
                      </td>
                      <td>
                        <span className={status === 'included' ? 'local-sent-label' : ''}>
                          {label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
