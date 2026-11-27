import type { SupportedModel } from '../lib/webllm.ts';
import { useEffect, useRef, useState } from 'react';
import { MIN_CONTEXT_TOKENS, modelContext } from '../lib/custom-models.ts';
import { gigabytes, thousands } from './ModelBadge.tsx';

const SUGGESTIONS = 8;
const shortName = (id: string) => id.replace(/-q4f16_1-MLC$/, '');
// A pasted link is added as typed; suggestions are for names only.
const isLink = (text: string) => /[/:]/.test(text);

// Context sizes for the suggestions on screen, read once each from Hugging Face.
function useContextSizes(models: SupportedModel[], shownIds: string) {
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const requested = useRef(new Set<string>());
  useEffect(() => {
    const shown = shownIds.split(',');
    for (const model of models) {
      if (!shown.includes(model.id) || requested.current.has(model.id)) continue;
      requested.current.add(model.id);
      void modelContext(model.url)
        .then((size) => setSizes((known) => ({ ...known, [model.id]: size })))
        .catch(() => requested.current.delete(model.id));
    }
  }, [shownIds, models]);
  return sizes;
}

// Type-ahead over the models the runtime can run. Everything happens in the browser:
// names and memory come from the installed runtime, context sizes from Hugging Face.
export function ModelSearch({
  models,
  total,
  onAdd,
}: {
  models: SupportedModel[];
  total: number;
  onAdd: (nameOrLink: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = models
    .filter((model) => words.every((word) => model.id.toLowerCase().includes(word)))
    .slice(0, SUGGESTIONS);
  const sizes = useContextSizes(models, open ? matches.map((model) => model.id).join() : '');
  const tooSmall = (id: string) => sizes[id] !== undefined && !(sizes[id]! >= MIN_CONTEXT_TOKENS);

  const add = async (nameOrLink: string) => {
    setAdding(true);
    setError('');
    setOpen(false);
    try {
      await onAdd(nameOrLink);
      setText('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setAdding(false);
    }
  };

  return (
    <form
      className="model-add"
      onSubmit={(event) => {
        event.preventDefault();
        const choice = open ? matches[active] : undefined;
        if (choice && tooSmall(choice.id)) return;
        void add(choice?.id ?? text);
      }}
    >
      <label htmlFor="model-link">Add another model</label>
      <div>
        <input
          id="model-link"
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-controls="model-suggestions"
          aria-activedescendant={open && matches[active] ? `model-option-${active}` : undefined}
          aria-autocomplete="list"
          value={text}
          placeholder="Search models, or paste a huggingface.co/mlc-ai link"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
            setOpen(!isLink(event.target.value));
          }}
          onFocus={() => setOpen(!isLink(text))}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              const step = event.key === 'ArrowDown' ? 1 : -1;
              setActive((active + step + matches.length) % Math.max(1, matches.length));
            } else if (event.key === 'Escape' && open) {
              event.preventDefault(); // Close the suggestions, not the dialog.
              setOpen(false);
            }
          }}
        />
        <button disabled={adding || !text.trim()}>{adding ? 'Checking…' : 'Add'}</button>
        {open && matches.length > 0 && (
          <ul id="model-suggestions" role="listbox" className="model-suggestions">
            {matches.map((model, index) => (
              <li
                key={model.id}
                id={`model-option-${index}`}
                role="option"
                aria-selected={index === active}
                aria-disabled={tooSmall(model.id)}
                // Keep focus in the field so the click is not lost to its blur.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => !tooSmall(model.id) && void add(model.id)}
              >
                <strong>{shortName(model.id)}</strong>
                <span>
                  {model.memoryMB ? `~${gigabytes(model.memoryMB)} memory` : 'Memory unknown'} ·{' '}
                  {sizes[model.id] === undefined
                    ? 'context…'
                    : `${thousands(sizes[model.id]!)} context${tooSmall(model.id) ? ` · this app needs ${thousands(MIN_CONTEXT_TOKENS)} or more` : ''}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && (
        <p className="model-add-error" role="alert">
          {error}
        </p>
      )}
      <p>
        Only the {total || ''} chat models built into this app’s WebLLM version can run. Other
        Hugging Face models, including some under{' '}
        <a href="https://huggingface.co/mlc-ai" target="_blank" rel="noopener noreferrer">
          mlc-ai
        </a>
        , are refused. Everything is checked in your browser and your list is saved only here.
      </p>
    </form>
  );
}
