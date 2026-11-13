import type { ChatMessage, JourneyStep, StepId } from '../lib/session-types.ts';
import type { SourceLink, RecordField, ReferenceRecord } from '../lib/types.ts';
import { Fragment } from 'react';
import { RetrievalDetail } from './RetrievalDetail.tsx';
import { PLAN_LABELS } from '../config/search-scope.ts';
import { RequestProgress, STEP_STATUS } from './RequestProgress.tsx';
import { Disclosure } from './StepDetails.tsx';
import { RequestDiagram } from './RequestDiagram.tsx';
import { MarkdownResponse } from './MarkdownResponse.ts';
import { Icon } from './Icons.tsx';

const number = (value: number | null | undefined) => (value == null ? '—' : value.toLocaleString());
const PLAN_DESCRIPTIONS = {
  search: 'Find matches for a topic, gene or variant.',
  overview: 'Review the full match list and choose a small selection.',
  other: 'Use the conversation to explain general information or ask for clarification.',
};

// Layout uses the reference's fixed field labels; source wording is unchanged.
const identityFields = new Set(['Variant ID (dbSNP)', 'Variant IDs (dbSNP)']);
const primaryFields = new Set(['Genotype', 'ClinVar classification', 'Reported classifications']);

function SourceLinks({ sources }: { sources: SourceLink[] }) {
  return (
    <span className="input-source-links">
      {sources.map((source) => (
        <Fragment key={source.url}>
          <a href={source.url} target="_blank" rel="noreferrer">
            {source.label}
          </a>{' '}
        </Fragment>
      ))}
    </span>
  );
}

function RecordFacts({ fields }: { fields: RecordField[] }) {
  return (
    <dl className="input-record-facts">
      {fields.map((field) => (
        <div key={field.label}>
          <dt>{field.label}</dt>
          <dd>
            {field.text}
            {field.items && (
              <ul>
                {field.items.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            )}
            {!!field.sources.length && (
              <>
                {' '}
                <SourceLinks sources={field.sources} />
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function RecordReference({ record }: { record: ReferenceRecord }) {
  const identifiers = record.fields
    .filter((field) => identityFields.has(field.label))
    .flatMap((field) => field.sources);
  const primary = record.fields.filter((field) => primaryFields.has(field.label));
  const supporting = record.fields.filter(
    (field) => !primaryFields.has(field.label) && !identityFields.has(field.label),
  );
  return (
    <article className="input-record">
      <header className="input-record-heading">
        <div>
          <h3>
            {record.gene ||
              (identifiers.length ? <SourceLinks sources={identifiers} /> : 'Variant')}
          </h3>
          {record.gene && !!identifiers.length && <SourceLinks sources={identifiers} />}
        </div>
        <span className="input-record-origin">
          {record.origin === 'earlier' ? 'Earlier answer' : 'This search'}
        </span>
      </header>
      <p className="input-record-location">{record.variant}</p>
      <RecordFacts fields={primary} />
      {!!supporting.length && (
        <Disclosure
          className="record-supporting"
          title={
            <>
              <Icon name="chevron" size={16} />
              <span>Conditions, review & sources</span>
            </>
          }
        >
          <RecordFacts fields={supporting} />
        </Disclosure>
      )}
    </article>
  );
}

export function EmbeddingsEvidence({ message }: { message: ChatMessage }) {
  const { journey, result, context } = message;
  if (!journey || !message.model) return null;
  const steps = Object.fromEntries(journey.steps.map((step) => [step.id, step])) as Record<
    StepId,
    JourneyStep
  >;
  const plan = steps.query.data?.response;
  const input = steps.context.data;
  const messages = input?.request?.messages ?? input?.messages ?? [];
  const reference = context?.recordReference;
  const recordCount = reference?.records.length ?? 0;
  const preparationFailure = [steps.catalog, steps.matching, steps.index].find((step) =>
    ['error', 'stopped'].includes(step.status),
  );
  const chosenRecords = message.answerSelection
    ? (reference?.records.filter((record) =>
        message.answerSelection!.selected.includes(record.id),
      ) ?? [])
    : [];
  const history = messages.slice(1, -1);

  const questionDetail = (
    <>
      <p className="step-description">
        {message.model.shortLabel} reads your question and recent conversation, then chooses one of
        the three approaches below. Your latest question takes priority; earlier exchanges help it
        understand follow-ups. For a specific topic, it also writes the search text. This happens on
        your device.
      </p>
      <RequestDiagram message={message} selected={0} />
      {plan?.query && (
        <p>
          <strong>Search for:</strong> {plan.query}
        </p>
      )}
      <h3>The three possible approaches</h3>
      <ul className="step-categories">
        {Object.entries(PLAN_DESCRIPTIONS).map(([mode, description]) => (
          <li key={mode} className={plan?.mode === mode ? 'is-selected' : ''}>
            <div>
              <strong>{PLAN_LABELS[mode as keyof typeof PLAN_LABELS]}</strong>
              {plan?.mode === mode && <span className="step-selected-label">Chosen</span>}
            </div>
            <p>{description}</p>
          </li>
        ))}
      </ul>
    </>
  );

  const inputDetail = (
    <>
      <p className="step-description">
        {message.general
          ? 'The local model receives your question, shared instructions and recent conversation. No new variant search is needed for this approach. Earlier exchanges are included as space allows, so it can respond to follow-ups.'
          : 'The app puts your question, shared instructions and a small set of matched records together for the local model. Relevant records from earlier answers and recent conversation can also be included, within the model’s available space. The complete genome and search vectors are not part of this input.'}
      </p>
      <RequestDiagram message={message} selected={2} />
      {context ? (
        <>
          {((context.omitted ?? 0) > 0 || context.omittedHistoryTurns > 0) && (
            <p className="step-footnote">
              {(context.omitted ?? 0) > 0 &&
                `New matches included: ${context.included} of ${number((context.included ?? 0) + (context.omitted ?? 0))}. `}
              {context.omittedHistoryTurns > 0 &&
                `Earlier exchanges left out to make room: ${context.omittedHistoryTurns}.`}
            </p>
          )}
          {!!recordCount && <h3>Records available to the model</h3>}
          {reference?.records.map((record) => (
            <RecordReference key={record.id} record={record} />
          ))}
          {!!history.length && (
            <Disclosure title="Earlier conversation included">
              {history.map((item, index) => (
                <div className="step-history-entry" key={index}>
                  <strong>{item.role === 'user' ? 'You' : 'Answer'}</strong>
                  <MarkdownResponse content={item.content} />
                </div>
              ))}
            </Disclosure>
          )}
        </>
      ) : (
        <p>
          {steps.context.status === 'skipped'
            ? 'No request was made to the answer model.'
            : 'The information for the model is not ready yet.'}
        </p>
      )}
    </>
  );

  const answerDetail = (
    <>
      <p className="step-description">
        {message.general
          ? 'The local model responds to your question using the conversation. It can explain general genetics from its own knowledge or ask for clarification when needed. This approach does not add new findings from your genome.'
          : 'The local model chooses relevant records from its input and writes a short answer based on them. The app adds the selected records’ exact genotype, classification, review information, frequencies and source links. You can see which records were chosen below and read the answer in the chat.'}
      </p>
      <RequestDiagram message={message} selected={3} />
      {!!chosenRecords.length && <h3>Records used in the answer</h3>}
      {chosenRecords.map((record) => (
        <RecordReference key={record.id} record={record} />
      ))}
      {message.answerSelection && !chosenRecords.length && (
        <p>The model did not select a variant record for this answer.</p>
      )}
      {message.limited && <p>The answer reached its length limit and may be incomplete.</p>}
      {['complete', 'running'].includes(steps.answer.status) && (
        <p className="step-footnote">
          {steps.answer.status === 'complete'
            ? 'The answer is shown in the chat.'
            : 'The answer will appear in the chat when ready.'}
        </p>
      )}
    </>
  );

  const status = journey.status;
  const summary = ['error', 'stopped', 'limited'].includes(status ?? '')
    ? `${STEP_STATUS[status!]} · open a step for details`
    : message.general
      ? 'Conversation answer · no new variant search'
      : context?.submitted
        ? `${number(result?.matches.length)} matches reviewed → ${recordCount} records provided to the local model`
        : 'Working on your question on this device…';
  const trail = [
    { ...steps.query, label: 'Question', detail: questionDetail },
    {
      ...steps.semantic,
      ...(preparationFailure
        ? { status: preparationFailure.status, summary: preparationFailure.summary }
        : {}),
      label: 'Find matches',
      detail: preparationFailure ? (
        <p>{preparationFailure.summary}</p>
      ) : (
        <RetrievalDetail message={message} step={steps.semantic} />
      ),
    },
    { ...steps.context, label: 'Model input', detail: inputDetail },
    { ...steps.answer, label: 'Answer', detail: answerDetail },
  ];
  return (
    <RequestProgress
      steps={trail}
      summary={summary}
      question={message.question}
      panelHeading={{
        eyebrow: 'GENOMEWALK / REQUEST JOURNEY',
        title: 'From your question to a local answer',
        subtitle: 'Follow the question, the selected evidence and the answer.',
      }}
    />
  );
}
