import type { ModelProfile } from '../lib/types.ts';
import type { ModelFacts, SupportedModel } from '../lib/webllm.ts';
import { useEffect, useRef, useState } from 'react';
import { LOCAL_MODELS } from '../config/models/index.ts';
import { loadCustomModels, resolveCustomModel, saveCustomModels } from '../lib/custom-models.ts';
import { Icon } from './Icons.tsx';
import { ModelBadge, gigabytes, thousands } from './ModelBadge.tsx';
import { ModelSearch } from './ModelSearch.tsx';

// Memory, cached state and the addable models, from the runtime's catalog. Loaded on
// demand: the catalog is large and not needed until the picker opens.
function useRuntimeCatalog(modelIds: string) {
  const [facts, setFacts] = useState<ModelFacts>({});
  const [supported, setSupported] = useState<SupportedModel[]>([]);
  useEffect(() => {
    let live = true;
    void import('../lib/webllm.ts')
      .then(({ modelFacts }) => modelFacts(modelIds.split(',')))
      .then((next) => {
        if (!live) return;
        setFacts(next.facts);
        setSupported(next.supported);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [modelIds]);
  return { facts, supported };
}

// The dialog for choosing the answer model: a search field to add one, then a table.
export function ModelPicker({
  current,
  locked,
  onSelect,
  onClose,
}: {
  current: ModelProfile | null;
  locked: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [custom, setCustom] = useState(loadCustomModels);
  // Models the user added come first, newest at the top.
  const models = [...custom, ...LOCAL_MODELS];
  const { facts, supported } = useRuntimeCatalog(models.map((model) => model.modelId).join());
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);
  const update = (next: ModelProfile[]) => {
    saveCustomModels(next);
    setCustom(next);
  };
  return (
    <dialog
      ref={dialog}
      className="model-picker"
      aria-labelledby="model-picker-title"
      onClose={(event) => {
        // Development double-mounts effects: ignore the first mount's close once reopened.
        if (!event.currentTarget.open) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialog.current?.close();
      }}
    >
      <header>
        <div>
          <h2 id="model-picker-title">Choose a local model</h2>
          <p>
            Every model runs in this browser on your GPU. Larger models answer better but need more
            memory and a longer first download.
          </p>
        </div>
        <button
          className="step-panel-close"
          aria-label="Close"
          onClick={() => dialog.current?.close()}
        >
          <Icon name="close" />
        </button>
      </header>
      <ModelSearch
        models={supported.filter((item) => !models.some((model) => model.modelId === item.id))}
        total={supported.length}
        onAdd={async (nameOrLink) => update([await resolveCustomModel(nameOrLink), ...custom])}
      />
      <div className="model-table" role="region" aria-label="Models" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Memory</th>
              <th scope="col">Context</th>
              <th scope="col">Files</th>
              <th scope="col">
                <span className="visually-hidden">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {models.map((model) => {
              const fact = facts[model.modelId];
              const selected = model.id === current?.id;
              return (
                <tr key={model.id} aria-selected={selected}>
                  <th scope="row">
                    <ModelBadge model={model} />
                    <span className="model-name">
                      <strong>
                        {model.label}
                        {model.tag && <span className="model-tag">{model.tag}</span>}
                      </strong>
                      <small>{[model.maker, model.blurb].filter(Boolean).join(' · ')}</small>
                    </span>
                  </th>
                  <td>{fact?.memoryMB ? `~${gigabytes(fact.memoryMB)}` : '—'}</td>
                  <td>{thousands(model.contextWindowTokens)}</td>
                  <td>{fact ? (fact.cached ? 'Downloaded' : 'Not yet') : '—'}</td>
                  <td>
                    {selected ? (
                      <span className="model-tag">In use</span>
                    ) : (
                      <button
                        className="model-use"
                        disabled={locked}
                        aria-label={`Use ${model.label}`}
                        onClick={() => {
                          onSelect(model.id);
                          dialog.current?.close();
                        }}
                      >
                        Use
                      </button>
                    )}
                    {model.custom && !selected && (
                      <button
                        className="model-remove"
                        aria-label={`Remove ${model.label}`}
                        title="Remove from this list"
                        onClick={() => update(custom.filter((item) => item.id !== model.id))}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </dialog>
  );
}
