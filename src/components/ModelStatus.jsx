import { Icon } from './Icons.jsx';

export function ModelStatus({ state, onRetry }) {
  if (!state.model)
    return (
      <section className="model-status" aria-label="Model status">
        <div className="status-heading">
          <span className="status-icon">
            <Icon name="chip" />
          </span>
          <div>
            <h2>Choose a local model</h2>
            <p>Your genome is ready. Choose a model to start chatting.</p>
          </div>
        </div>
      </section>
    );
  const loading =
    state.phase === 'loading' ||
    state.phase === 'checking' ||
    state.phase === 'idle' ||
    state.phase === 'switching';
  if (state.phase === 'ready') return null;
  return (
    <section
      className={`model-status ${state.phase === 'error' ? 'model-error' : ''}`}
      aria-label="Model status"
    >
      <div className="status-heading">
        <span className={loading ? 'loading-ring' : 'status-icon'}>
          {!loading && <Icon name="chip" />}
        </span>
        <div>
          <h2>{loading ? 'Making room for curiosity' : 'The model needs your attention'}</h2>
          <p>
            {loading
              ? `Loading ${state.model.label} on your device`
              : 'Local inference is unavailable'}
          </p>
        </div>
        {loading && <span className="progress-number">{Math.round(state.progress * 100)}%</span>}
      </div>
      {loading && (
        <>
          <progress max="1" value={state.progress} aria-label="Model initialization progress" />
          <p className="progress-detail" role="status">
            {state.progressText}
          </p>
          <p className="download-note">
            The first load downloads this model’s files. Your browser caches them for next time.
          </p>
        </>
      )}
      {state.phase === 'error' && (
        <>
          <p className="error-copy" role="alert">
            {state.error?.message}
          </p>
          {state.error?.detail && (
            <details>
              <summary>Technical details</summary>
              <pre>{state.error.detail}</pre>
            </details>
          )}
          <button className="retry-button" onClick={onRetry}>
            <Icon name="refresh" size={16} /> Retry model loading
          </button>
        </>
      )}
    </section>
  );
}
