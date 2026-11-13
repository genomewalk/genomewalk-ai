import type { LocalModelState } from '../lib/local-model-session.ts';
import { LOCAL_MODELS } from '../config/models/index.ts';
import { Icon } from './Icons.tsx';

export function ModelSelector({
  state,
  onSelect,
  disabled = false,
}: {
  state: LocalModelState;
  onSelect: (id: string) => void | Promise<boolean>;
  disabled?: boolean;
}) {
  const locked =
    disabled ||
    state.busy ||
    state.reserved ||
    ['switching', 'checking', 'loading'].includes(state.phase);
  return (
    <div className="model-selector">
      <div className="model-selector-control">
        <label htmlFor="local-model">Local model</label>
        <div className="model-select-field">
          <select
            id="local-model"
            value={state.model?.id ?? ''}
            disabled={locked}
            onChange={(event) => {
              void onSelect(event.target.value);
            }}
            aria-describedby="local-model-note"
          >
            <option value="" disabled>
              Choose a model…
            </option>
            {LOCAL_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
          <Icon name="chevron" size={16} />
        </div>
        <span>
          {state.model
            ? `${state.model.contextWindowTokens.toLocaleString()}-token context · 4-bit`
            : 'No model loaded'}
        </span>
      </div>
      <p id="local-model-note">
        {!state.model ? (
          'Choose an answer model to download or load its cached files. It will not load automatically.'
        ) : (
          <>
            Switching keeps this private conversation and adapts it to the selected model’s context.
            One model is loaded at a time. {state.model.note}
          </>
        )}
      </p>
    </div>
  );
}
