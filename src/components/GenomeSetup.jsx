import { useRef, useState } from 'react';
import { chooseGenomeFile } from '../lib/genome-source.js';
import { EXAMPLE_GENOME } from '../config/example-genome.js';
import { BrandMark, Icon } from './Icons.jsx';
import { RequestProgress } from './RequestProgress.jsx';
import { PreparationDiagram } from './PreparationDiagram.jsx';

export function PreparationProgress({ journey, summary, genome }) {
  return (
    <RequestProgress
      title="Genome preparation"
      steps={journey.steps.slice(0, 3).map((step, index) => ({
        ...step,
        label: ['Catalog', 'Match', 'Search index'][index],
        detail: <PreparationDiagram journey={journey} selected={index} genome={genome} />,
      }))}
      summary={summary}
      panelHeading={{
        eyebrow: 'GENOMEWALK / PREPARATION',
        title: 'From a genome file to private search',
        subtitle: 'One public reference. Three steps on your device.',
      }}
    />
  );
}

export function GenomeSetup({ state, onSelect, onRetry, onStop, onContinue }) {
  const input = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false);
  const preparing = state.busy || state.switching;
  const select = async (files) => {
    if (preparing || (files && !files.length)) return;
    try {
      const file = files ? chooseGenomeFile(files) : null;
      setError('');
      setAttempted(true);
      await onSelect(file);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <main className="genome-intake">
      <header className="intake-header">
        <div className="brand">
          <BrandMark />
          <span>
            genomewalk<span className="brand-ai">AI</span>
          </span>
        </div>
      </header>
      <section className="intake-content" aria-labelledby="intake-title">
        <div className="intake-intro">
          <p className="eyebrow">START WITH A GENOME</p>
          <h1 id="intake-title">
            Your genome.
            <br />
            <em>Your questions.</em>
          </h1>
          <p>
            Choose your genome file or explore a public sample. We’ll find its ClinVar matches, then
            you can ask questions in a private chat.
          </p>
          <div className="intake-privacy">
            <Icon name="shield" size={22} />
            <p>Your file stays in this browser. Matching, search and answers run on your device.</p>
          </div>
        </div>
        <div className="intake-loader">
          <div className="intake-loader-heading">
            <span>CHOOSE A GENOME</span>
            <span>{preparing ? 'PREPARING' : 'FILE OR SAMPLE'}</span>
          </div>
          <section
            className={`genome-drop ${dragging ? 'is-dragging' : ''}`}
            aria-label="Use your own genome"
            onDragOver={(event) => {
              event.preventDefault();
              if (!preparing) setDragging(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void select(event.dataTransfer.files);
            }}
          >
            <div className="genome-file-symbol">
              <Icon name="folder" size={30} />
            </div>
            <h2>Use your own genome</h2>
            <p>VCF, 23andMe or AncestryDNA</p>
            <p className="genome-drop-hint">
              VCF: GRCh38 · .vcf or .vcf.gz
              <br />
              23andMe / Ancestry: GRCh37 or GRCh38 · .txt, .txt.gz or .zip
            </p>
            <input
              ref={input}
              hidden
              type="file"
              accept=".vcf,.vcf.gz,.txt,.txt.gz,.zip,.gz,.tbi,.csi"
              multiple
              disabled={preparing}
              aria-label="Choose a genome file"
              onChange={(event) => {
                void select(event.target.files);
                event.target.value = '';
              }}
            />
            <button
              className="genome-pick-button"
              disabled={preparing}
              onClick={() => input.current.click()}
            >
              Choose genome file <Icon name="folder" size={18} />
            </button>
            <p className="genome-drop-hint">or drag and drop it here</p>
          </section>
          <div className="genome-sample-choice">
            <button disabled={preparing} onClick={() => void select(null)}>
              <span>
                Try the HG002 sample <Icon name="chevron" size={17} />
              </span>
              <small>NIST Genome in a Bottle · GRCh38 · 42 MB</small>
            </button>
            <p>
              Public GRCh38 benchmark variant calls.{' '}
              <a href={EXAMPLE_GENOME.source} target="_blank" rel="noreferrer">
                About this sample
              </a>
            </p>
          </div>
          {(attempted || preparing || state.indexReady) && (
            <div className="intake-progress">
              <div className="intake-progress-heading">
                <strong title={state.genome.name}>{state.genome.label}</strong>
                {preparing ? (
                  <button
                    className="text-button"
                    disabled={state.stopping || state.switching}
                    onClick={onStop}
                  >
                    {state.stopping ? 'Stopping…' : 'Pause'}
                  </button>
                ) : (
                  !state.indexReady && (
                    <button className="text-button" onClick={onRetry}>
                      Retry preparation
                    </button>
                  )
                )}
              </div>
              <PreparationProgress
                journey={state.preparationJourney}
                genome={state.genome}
                summary={
                  preparing
                    ? state.progressText || 'Preparing local search…'
                    : state.indexReady
                      ? 'Ready. Inspect any step, or continue to chat.'
                      : state.phase === 'error'
                        ? 'Preparation needs attention.'
                        : 'Preparation paused.'
                }
              />
              {state.indexReady && !preparing && (
                <button className="genome-pick-button intake-continue" onClick={onContinue}>
                  Continue to chat <Icon name="chevron" size={18} />
                </button>
              )}
              {state.error && (
                <p className="genome-file-error" role="alert">
                  {state.error.message}
                </p>
              )}
            </div>
          )}
          {error && (
            <p className="genome-file-error intake-file-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <p className="intake-footnote">
          {state.indexReady ? 'Choosing a different genome clears the current chat. ' : ''}Reference
          data and model files download as needed. Choose your answer model separately in chat.
        </p>
      </section>
    </main>
  );
}
