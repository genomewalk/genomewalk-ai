import type { LocalModelState } from '../lib/local-model-session.ts';
import { useState } from 'react';
import { Icon } from './Icons.tsx';
import { ModelBadge, thousands } from './ModelBadge.tsx';
import { ModelPicker } from './ModelPicker.tsx';

// Sidebar control: shows the current answer model and opens the picker.
export function ModelSelector({
  state,
  onSelect,
  disabled = false,
}: {
  state: LocalModelState;
  onSelect: (id: string) => void | Promise<boolean>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const locked =
    disabled ||
    state.busy ||
    state.reserved ||
    ['switching', 'checking', 'loading'].includes(state.phase);
  const model = state.model;
  return (
    <div className="model-selector">
      <span className="model-selector-label">Local model</span>
      <button
        className="model-current"
        aria-haspopup="dialog"
        aria-describedby="local-model-note"
        onClick={() => setOpen(true)}
      >
        {model ? <ModelBadge model={model} /> : <Icon name="chip" size={22} />}
        <span className="model-name">
          <strong>{model?.label ?? 'Choose a model…'}</strong>
          <small>
            {model ? `${thousands(model.contextWindowTokens)} context · 4-bit` : 'None loaded yet'}
          </small>
        </span>
        <Icon name="chevron" size={16} />
      </button>
      <p id="local-model-note">
        {!model ? (
          'Choose an answer model to download or load its cached files. It will not load automatically.'
        ) : (
          <>
            Switching keeps this private conversation and adapts it to the selected model’s context.
            One model is loaded at a time. {model.note}
          </>
        )}
      </p>
      {open && (
        <ModelPicker
          current={model}
          locked={locked}
          onSelect={(id) => void onSelect(id)}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
