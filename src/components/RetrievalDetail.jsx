import { Disclosure } from './StepDetails.jsx';
import { RequestDiagram } from './RequestDiagram.jsx';
import { MAX_RECORDS } from '../config/evidence-answer.js';

export function RetrievalDetail({ message, step }) {
  const data = step.data;
  const context = message.context;
  const considered = new Map(
    context?.consideredRows?.map((row) => [row.citation, row.status]) ?? [],
  );
  const limit = context?.maxNewRecords ?? MAX_RECORDS;
  if (step.status === 'skipped')
    return (
      <>
        <p className="step-description">
          This question continues directly to the local model, using your question and recent
          conversation. No new genome records are searched or added. The next step shows the
          conversation included for the answer.
        </p>
        <RequestDiagram message={message} selected={1} />
      </>
    );
  return (
    <>
      <p className="step-description">
        {(data?.mode ??
          message.journey.steps.find((item) => item.id === 'query').data?.response?.mode) ===
        'overview'
          ? 'For an overview, the app considers the whole pool of usable genome matches and orders it by ClinVar classification, then review stars. No topic search is needed.'
          : 'The local embedding model compares the meaning of the search text with your indexed matches. The app combines that similarity with ClinVar classification and review stars to order the records in one pass.'}{' '}
        Up to {limit} new records are prepared for the answer, as space allows. This order helps
        choose records to review; it does not measure personal risk.
      </p>
      <RequestDiagram message={message} selected={1} />
      {data && (
        <>
          {data.mode === 'search' && (
            <p>
              <strong>Searching for:</strong> {data.query}
            </p>
          )}
          <h3>Matches in review order</h3>
          <p>
            Showing the first {data.rows.length} of {data.total.toLocaleString()} matches. Expand a
            gene to inspect its record. Follow-ups may also include earlier records.
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
                  <th scope="col">From this search</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((hit) => {
                  const row = message.result.matches[hit.index];
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
