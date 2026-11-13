import { useState, useSyncExternalStore } from 'react';
import { embeddingsSession as session } from '../lib/embeddings-session.ts';
import { localModelSession } from '../lib/local-model-session.ts';
import { BrandMark, Icon } from './Icons.tsx';
import { ModelSelector } from './ModelSelector.tsx';
import { ModelStatus } from './ModelStatus.tsx';
import { MessageList } from './MessageList.tsx';
import { ChatInput } from './ChatInput.tsx';
import { GenomeSetup, PreparationProgress } from './GenomeSetup.tsx';
import { RankingSettings } from './RankingSettings.tsx';

export function EmbeddingsChat() {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const local = useSyncExternalStore(localModelSession.subscribe, localModelSession.getSnapshot);
  const [draft, setDraft] = useState('');
  const [choosingGenome, setChoosingGenome] = useState(!state.indexReady);
  const ready = local.phase === 'ready' && !local.busy && !local.reserved;
  const hasMessages = state.messages.length > 0;
  const clear = () => {
    setDraft('');
    session.clear();
  };
  const send = () => {
    if (!ready || state.busy || !draft.trim()) return;
    const question = draft;
    setDraft('');
    void session.send(question).then((accepted) => {
      if (!accepted) setDraft(question);
    });
  };
  const selectGenome = async (file: File | null) => {
    setDraft('');
    await session.selectGenome(file);
  };
  if (choosingGenome)
    return (
      <GenomeSetup
        state={state}
        onSelect={selectGenome}
        onRetry={() => session.prepare()}
        onStop={() => session.stop()}
        onContinue={() => setChoosingGenome(false)}
      />
    );
  return (
    <div className="app-shell embeddings-mode">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <span>
            genomewalk<span className="brand-ai">AI</span>
          </span>
        </div>
        <button className="new-chat" disabled={state.busy || !hasMessages} onClick={clear}>
          <Icon name="plus" size={18} /> New conversation
        </button>
        <ModelSelector
          state={local}
          disabled={state.activity === 'answering'}
          onSelect={(id) => localModelSession.selectModel(id)}
        />
        <RankingSettings
          weights={state.weights}
          busy={state.busy}
          onChange={(weights) => session.setWeights(weights)}
        />
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <Icon name="shield" size={23} />
            <h2>
              Local search.
              <br />
              Local answers.
            </h2>
            <p>
              Exact genome matching, semantic search and ranking run on this device. No questions or
              results are sent to a cloud model.
            </p>
          </div>
        </div>
      </aside>
      <main className="main-panel">
        <header className="chat-header">
          <div>
            <span className="mobile-brand">genomewalk AI</span>
            <h1>Local + Embeddings</h1>
          </div>
          <div className="header-actions">
            <span className="status-badge">
              {state.busy
                ? 'Working locally'
                : ready
                  ? 'Ready'
                  : !local.model
                    ? 'Choose a model'
                    : 'Preparing'}
            </span>
            <button className="clear-button" disabled={state.busy || !hasMessages} onClick={clear}>
              Clear chat
            </button>
          </div>
        </header>
        <div className="genome-source-bar" aria-label="Selected genome">
          <div>
            <span>
              {state.genome.kind === 'example'
                ? 'Public example'
                : (state.genome.provider ?? 'Local file')}
            </span>
            <strong title={state.genome.name}>{state.genome.label}</strong>
            <span>{state.genome.build}</span>
            <span>
              {state.matchCount.toLocaleString()} {state.matchCount === 1 ? 'match' : 'matches'}
            </span>
          </div>
          <button
            className="text-button"
            disabled={state.busy}
            onClick={() => setChoosingGenome(true)}
          >
            Change genome
          </button>
          <details className="genome-storage">
            <summary>Saved data</summary>
            <p>Matches are saved in this browser. Conversations last for this visit.</p>
            <button
              className="text-button"
              disabled={state.busy}
              onClick={() => {
                setDraft('');
                session.forget();
                setChoosingGenome(true);
              }}
            >
              Forget saved matches and chat
            </button>
          </details>
          <details className="genome-preparation">
            <summary>Preparation details</summary>
            <PreparationProgress journey={state.preparationJourney} genome={state.genome} />
          </details>
        </div>
        <div className={`chat-body ${hasMessages ? 'has-messages' : ''}`}>
          {hasMessages ? (
            <MessageList messages={state.messages} busy={state.busy} />
          ) : (
            <div className="welcome-scroll">
              <section className="welcome local-welcome">
                <p className="eyebrow">FULLY LOCAL GENOME CHAT</p>
                <h2>
                  Your matches.
                  <br />
                  <em>Search them privately.</em>
                </h2>
                <p className="welcome-copy">
                  Ask a general genetics question, or search your matched records. General
                  explanations use local model knowledge; answers about your variants show selected
                  source facts with links.
                </p>
                <div className="starter-grid">
                  {[
                    'Do I have variants related to hearing loss?',
                    'Do I have any cancer-related variants?',
                    'Give me an overview of my catalog matches.',
                  ].map((q) => (
                    <button key={q} disabled={!ready || state.busy} onClick={() => setDraft(q)}>
                      {q}
                    </button>
                  ))}
                </div>
              </section>
            </div>
          )}
          {local.phase !== 'ready' && (
            <div className="conversation-status">
              <ModelStatus state={local} onRetry={() => localModelSession.initialize()} />
            </div>
          )}
          {state.error && (
            <div className="generation-error" role="alert">
              {state.error.message}
            </div>
          )}
          <ChatInput
            awaitingModel={!local.model}
            value={draft}
            onChange={setDraft}
            onSend={send}
            onStop={() => session.stop()}
            ready={ready && !state.busy && !state.switching}
            busy={state.activity === 'answering'}
            stopping={state.stopping}
          />
        </div>
        <footer className="app-footer">
          <span>{state.genome.build} · allele matching</span>
          <span>Private search and inference · public reference and model downloads</span>
        </footer>
      </main>
    </div>
  );
}
