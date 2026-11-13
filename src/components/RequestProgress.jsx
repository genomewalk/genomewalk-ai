import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icons.jsx';

export const STEP_STATUS = {
  pending: 'Waiting',
  running: 'Working',
  complete: 'Done',
  skipped: 'Skipped',
  error: 'Failed',
  stopped: 'Stopped',
  limited: 'Limit reached',
};

const PANEL_WIDTH_KEY = 'genomewalk.step-panel-width';
const MIN_PANEL_WIDTH = 440;
const DEFAULT_PANEL_WIDTH = 860;

function savedPanelWidth() {
  try {
    const value = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    return Number.isFinite(value) && value >= MIN_PANEL_WIDTH ? value : null;
  } catch {
    return null;
  }
}

function StepPanel({ steps, selected, onSelect, onClose, question, heading }) {
  const dialog = useRef(null);
  const titleId = useId();
  const stepLabelId = useId();
  const panelId = useId();
  const drag = useRef(null);
  const [preferredWidth, setPreferredWidth] = useState(savedPanelWidth);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [dragging, setDragging] = useState(false);
  const step = steps[selected];
  useEffect(() => {
    const node = dialog.current;
    node.showModal();
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      node.close();
    };
  }, []);
  const compact = viewportWidth <= 600;
  const minimum = Math.min(MIN_PANEL_WIDTH, viewportWidth);
  const maximum = Math.max(minimum, viewportWidth - 24);
  const clamp = (value) => Math.max(minimum, Math.min(maximum, Math.round(value)));
  const width = compact ? viewportWidth : clamp(preferredWidth ?? DEFAULT_PANEL_WIDTH);
  const updateWidth = (value, persist = false) => {
    const next = value === null ? null : clamp(value);
    setPreferredWidth(next);
    if (persist) {
      try {
        if (next === null) localStorage.removeItem(PANEL_WIDTH_KEY);
        else localStorage.setItem(PANEL_WIDTH_KEY, String(next));
      } catch {
        /* Resizing remains available without browser storage. */
      }
    }
  };
  const finishDrag = (event, cancelled = false) => {
    const start = drag.current;
    if (!start || start.pointerId !== event.pointerId) return;
    drag.current = null;
    if (cancelled) setPreferredWidth(start.preference);
    else updateWidth(start.width + start.x - event.clientX, true);
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return createPortal(
    <dialog
      ref={dialog}
      id={panelId}
      className={`step-panel${dragging ? ' is-resizing' : ''}`}
      style={{ width }}
      aria-labelledby={heading ? `${titleId} ${stepLabelId}` : titleId}
      onClose={(event) => {
        if (!event.currentTarget.open) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialog.current.close();
      }}
    >
      {!compact && (
        <div
          className="step-panel-resizer"
          role="separator"
          tabIndex={0}
          aria-label="Resize step panel"
          aria-orientation="vertical"
          aria-controls={panelId}
          aria-valuemin={minimum}
          aria-valuemax={maximum}
          aria-valuenow={width}
          aria-valuetext={`${width} pixels`}
          title="Drag left to widen, right to narrow. Use arrow keys, or double-click to reset."
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = {
              pointerId: event.pointerId,
              x: event.clientX,
              width,
              preference: preferredWidth,
            };
            setDragging(true);
          }}
          onPointerMove={(event) => {
            if (drag.current?.pointerId === event.pointerId)
              updateWidth(drag.current.width + drag.current.x - event.clientX);
          }}
          onPointerUp={(event) => finishDrag(event)}
          onPointerCancel={(event) => finishDrag(event, true)}
          onLostPointerCapture={(event) => finishDrag(event, true)}
          onDoubleClick={() => updateWidth(null, true)}
          onKeyDown={(event) => {
            const next = {
              ArrowLeft: width + 16,
              ArrowRight: width - 16,
              Home: minimum,
              End: maximum,
            }[event.key];
            if (next === undefined) return;
            event.preventDefault();
            updateWidth(next, true);
          }}
        />
      )}
      <div className="step-panel-shell">
        <header className="step-panel-header">
          <div className="step-panel-heading">
            {heading ? (
              <div className="step-panel-heading-meta">
                <p className="eyebrow">{heading.eyebrow}</p>
                <p className="step-panel-current" id={stepLabelId}>
                  STEP {selected + 1} OF {steps.length} · {step.label}
                </p>
              </div>
            ) : (
              <p className="eyebrow">
                ON THIS DEVICE · STEP {selected + 1} OF {steps.length}
              </p>
            )}
            <h2 id={titleId}>{heading?.title ?? step.title ?? step.label}</h2>
            {heading?.subtitle && <p className="step-panel-subtitle">{heading.subtitle}</p>}
          </div>
          <button
            className="step-panel-close"
            autoFocus
            aria-label="Close step details"
            onClick={() => dialog.current.close()}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="step-panel-body" key={step.id}>
          {question && <p className="step-panel-question">{question}</p>}
          <p className={`step-panel-status is-${step.status}`}>
            <span />
            {STEP_STATUS[step.status]}
            {['error', 'stopped', 'limited'].includes(step.status) && step.summary && (
              <> · {step.summary}</>
            )}
          </p>
          <div className="step-panel-detail">{step.detail}</div>
        </div>
        <footer className="step-panel-footer">
          <button disabled={selected === 0} onClick={() => onSelect(selected - 1)}>
            Previous step
          </button>
          <span>
            {selected + 1} / {steps.length}
          </span>
          <button disabled={selected === steps.length - 1} onClick={() => onSelect(selected + 1)}>
            Next step
          </button>
        </footer>
      </div>
    </dialog>,
    document.body,
  );
}

export function RequestProgress({
  steps,
  title = 'Request journey',
  summary,
  question,
  panelHeading,
}) {
  const [selected, setSelected] = useState(null);
  return (
    <section className="request-progress" aria-label={title}>
      <div className="request-progress-heading">
        <strong>{title}</strong>
        <span>Click a step to explore</span>
      </div>
      <ol className="progress-trail">
        {steps.map((step, index) => (
          <li key={step.id} className={`is-${step.status}`}>
            <button
              aria-label={`Step ${index + 1}: ${step.label} — ${STEP_STATUS[step.status]}`}
              aria-haspopup="dialog"
              aria-current={step.status === 'running' ? 'step' : undefined}
              onClick={() => setSelected(index)}
            >
              <span className="progress-circle" aria-hidden="true">
                {index + 1}
              </span>
              <strong>{step.label}</strong>
              <small>{STEP_STATUS[step.status]}</small>
            </button>
          </li>
        ))}
      </ol>
      {summary && (
        <p className="request-progress-summary" role="status">
          {summary}
        </p>
      )}
      {selected !== null && (
        <StepPanel
          steps={steps}
          selected={selected}
          onSelect={setSelected}
          onClose={() => setSelected(null)}
          question={question}
          heading={panelHeading}
        />
      )}
    </section>
  );
}
