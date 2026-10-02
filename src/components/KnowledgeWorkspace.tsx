import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  ExternalLink,
  Lightbulb,
  LoaderCircle,
  Mic,
  Pause,
  Search,
  Trash2,
} from 'lucide-react';
import type { Settings } from '../../shared/types';
import {
  flagLabels,
  type KnowledgeCard,
  type KnowledgeEntry,
  type KnowledgeInput,
  type KnowledgeSource,
  type KnowledgeStatus,
  type KnowledgeTopic,
} from '../../shared/knowledge';
import { Microphone } from '../lib/audio';
import { api } from '../lib/api';
import { analyzeKnowledge } from '../lib/knowledge';

function Sources({ sources }: { sources: KnowledgeSource[] }) {
  return (
    <div className="knowledge-sources">
      {sources.map((source) => (
        <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">
          {source.title}
          <ExternalLink size={12} />
        </a>
      ))}
    </div>
  );
}
function Card({ card }: { card: KnowledgeCard }) {
  return (
    <article className="knowledge-card">
      <div className="knowledge-card-heading">
        <span className="eyebrow">IN CONTEXT</span>
        <BookOpen size={18} />
      </div>
      <h3>{card.keyword}</h3>
      <p className="knowledge-explanation">{card.explanation}</p>
      <Sources sources={card.sources} />
      {!!card.related.length && (
        <div className="related-concepts">
          <span>Connects to</span>
          {card.related.map((term, index) => (
            <span className="concept" key={index}>
              {term}
            </span>
          ))}
        </div>
      )}
      {card.background && (
        <div className="knowledge-background">
          <h4>A little deeper</h4>
          <p>{card.background}</p>
        </div>
      )}
      {card.flag && (
        <div className={`claim-flag intensity-${card.flag.level.length}`}>
          <div>
            <strong className="intensity-mark" aria-label={flagLabels[card.flag.level]}>
              {card.flag.level}
            </strong>
            <strong>{flagLabels[card.flag.level]}</strong>
          </div>
          <blockquote>“{card.flag.claim}”</blockquote>
          <p>{card.flag.explanation}</p>
          <Sources sources={card.flag.sources} />
        </div>
      )}
    </article>
  );
}
type LibraryPage = { entries: KnowledgeEntry[]; nextOffset: number | null };

export function KnowledgeWorkspace({ settings }: { settings: Settings }) {
  const [tab, setTab] = useState<'live' | 'library'>('live');
  const [configuration, setConfiguration] = useState<KnowledgeStatus | null>(null);
  const [live, setLive] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [text, setText] = useState('');
  const [topics, setTopics] = useState<KnowledgeTopic[]>([]);
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [library, setLibrary] = useState<KnowledgeEntry[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [processing, setProcessing] = useState(false);
  const [queued, setQueued] = useState(0);
  const [failed, setFailed] = useState<KnowledgeInput | null>(null);
  const microphone = useRef<Microphone | null>(null);
  const queue = useRef<KnowledgeInput[]>([]);
  const working = useRef(false);
  const blocked = useRef(false);
  const alive = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const sessionId = useRef(crypto.randomUUID());
  const seen = useRef(new Set<string>());

  useEffect(() => {
    alive.current = true;
    void api<KnowledgeStatus>('/knowledge/status')
      .then((value) => {
        if (alive.current) setConfiguration(value);
      })
      .catch((error) => {
        if (alive.current) setError(error.message);
      });
    return () => {
      alive.current = false;
      microphone.current?.stop();
      controller.current?.abort();
      queue.current = [];
    };
  }, []);
  function stopListening() {
    microphone.current?.stop();
    microphone.current = null;
    setLive(false);
    setConnecting(false);
  }
  async function loadLibrary(offset = 0) {
    setLibraryLoading(true);
    try {
      const page = await api<LibraryPage>(`/knowledge/library?offset=${offset}`);
      if (!alive.current) return;
      setLibrary((previous) => (offset ? [...previous, ...page.entries] : page.entries));
      setNextOffset(page.nextOffset);
    } catch (error) {
      if (alive.current) setError((error as Error).message);
    } finally {
      if (alive.current) setLibraryLoading(false);
    }
  }
  async function drain() {
    if (working.current || blocked.current || !alive.current) return;
    const input = queue.current.shift();
    if (!input) return;
    working.current = true;
    setProcessing(true);
    setQueued(queue.current.length);
    setTopics([]);
    setNotice('');
    const request = new AbortController();
    controller.current = request;
    try {
      await analyzeKnowledge(input, request.signal, (event) => {
        if (!alive.current || request.signal.aborted) return;
        if (event.type === 'keywords') setTopics(event.topics);
        if (event.type === 'complete') {
          setTopics([]);
          if (event.entry.cards.length) {
            setEntries((previous) => [
              event.entry,
              ...previous.filter((entry) => entry.id !== event.entry.id),
            ]);
            setLibrary((previous) => [
              event.entry,
              ...previous.filter((entry) => entry.id !== event.entry.id),
            ]);
          } else
            setNotice(
              'No new terms with enough supporting evidence in this passage. Listening can continue.',
            );
        }
      });
    } catch (error) {
      if (alive.current && !request.signal.aborted) {
        blocked.current = true;
        setFailed(input);
        setError((error as Error).message);
        stopListening();
      }
    } finally {
      working.current = false;
      if (alive.current) {
        setProcessing(false);
        if (!blocked.current) void drain();
      }
    }
  }
  function enqueue(value: string) {
    const spoken = value.trim();
    if (!spoken) return;
    // Preserve long transcripts without violating the server's per-passage limit.
    for (let start = 0; start < spoken.length; start += 2000) {
      queue.current.push({
        id: crypto.randomUUID(),
        sessionId: sessionId.current,
        text: spoken.slice(start, start + 2000),
      });
    }
    setQueued(queue.current.length);
    if (queue.current.length >= 8) {
      stopListening();
      setNotice(
        'Listening paused while research catches up. All captured passages are queued; resume when they finish.',
      );
    }
    void drain();
  }
  async function startListening() {
    if (microphone.current || blocked.current) return;
    setError('');
    setNotice('');
    setConnecting(true);
    setLive(true);
    seen.current.clear();
    const capture = new Microphone(
      settings,
      {
        onReady: () => {
          if (alive.current && microphone.current === capture) setConnecting(false);
        },
        onSpeech: () => {},
        onCommit: () => {},
        onLevel: () => {},
        onPartial: (_id, value) => {
          if (alive.current && microphone.current === capture) setTranscript(value);
        },
        onFinal: (id, value) => {
          if (!alive.current || microphone.current !== capture || seen.current.has(id)) return;
          seen.current.add(id);
          setTranscript(value);
          capture.resume();
          enqueue(value);
        },
        onError: (message) => {
          if (alive.current && microphone.current === capture) {
            setError(message);
            stopListening();
          }
        },
      },
      { audioPath: '/api/knowledge/audio' },
    );
    microphone.current = capture;
    await capture.start();
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setTranscript(text);
    enqueue(text);
    setText('');
  }
  async function remove(entry: KnowledgeEntry) {
    try {
      await api(`/knowledge/library/${entry.id}`, undefined, 'DELETE');
      if (!alive.current) return;
      setLibrary((previous) => previous.filter((item) => item.id !== entry.id));
      setEntries((previous) => previous.filter((item) => item.id !== entry.id));
    } catch (error) {
      setError((error as Error).message);
    }
  }
  const latestCards = [
    ...new Map(
      entries
        .flatMap((entry) => entry.cards)
        .reverse()
        .map((card) => [card.keyword.toLowerCase(), card]),
    ).values(),
  ].reverse();
  const questions = entries[0]?.questions || [];
  const filtered = library.filter((entry) =>
    JSON.stringify([entry.text, entry.cards, entry.questions])
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  return (
    <section className="knowledge-page">
      <div className="knowledge-heading">
        <div>
          <p className="eyebrow">FOLLOW YOUR CURIOSITY</p>
          <h2>More meaning in every conversation.</h2>
          <p>Key terms, clear explanations, and new directions to explore.</p>
        </div>
        <span className="knowledge-language">ENGLISH</span>
      </div>
      <div className="knowledge-tabs" aria-label="Knowledge views">
        <button
          className={tab === 'live' ? 'active' : ''}
          aria-pressed={tab === 'live'}
          onClick={() => setTab('live')}
        >
          <Mic size={16} />
          Live knowledge
        </button>
        <button
          className={tab === 'library' ? 'active' : ''}
          aria-pressed={tab === 'library'}
          onClick={() => {
            stopListening();
            setTab('library');
            void loadLibrary();
          }}
        >
          <BookOpen size={16} />
          Your library
        </button>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {failed && (
        <div className="knowledge-retry">
          <p>Captured passage: “{failed.text}”</p>
          <button
            className="secondary-button"
            disabled={processing}
            onClick={() => {
              queue.current.unshift(failed);
              blocked.current = false;
              setFailed(null);
              setError('');
              void drain();
            }}
          >
            Retry research
          </button>
          <button
            className="text-button"
            onClick={() => {
              blocked.current = false;
              setFailed(null);
              setError('');
              setTopics([]);
              void drain();
            }}
          >
            Skip this passage
          </button>
        </div>
      )}
      {tab === 'live' ? (
        <div className="knowledge-layout">
          <div>
            <section
              className={`knowledge-listening ${live ? 'is-listening' : ''}`}
              aria-label="Knowledge listening"
            >
              <div className="card-top">
                <span className="surface-label">
                  <span className={`live-dot ${live ? 'active' : ''}`} />
                  {connecting ? 'CONNECTING' : live ? 'LISTENING' : 'READY TO DISCOVER'}
                </span>
                {processing && (
                  <span className="research-status">
                    <LoaderCircle size={15} className="spin" />
                    Researching{queued > 0 ? ` · ${queued} queued` : ''}
                  </span>
                )}
              </div>
              <p className={`knowledge-transcript ${transcript ? '' : 'muted'}`} aria-live="polite">
                {transcript || 'Start listening. Important words become a little more familiar.'}
              </p>
              <div className="knowledge-controls">
                <button
                  className={`primary-button ${live ? 'recording' : ''}`}
                  disabled={!configuration?.configured || !!failed || (!live && queued >= 8)}
                  onClick={() => (live ? stopListening() : void startListening())}
                >
                  {live ? <Pause size={17} /> : <Mic size={17} />}
                  {live ? 'End listening' : 'Start listening'}
                </button>
                <span>English speech · automatically saved</span>
                <button
                  className="text-button"
                  disabled={live || processing || queued > 0 || !!failed}
                  onClick={() => {
                    sessionId.current = crypto.randomUUID();
                    setEntries([]);
                    setTopics([]);
                    setTranscript('');
                    setNotice('New session. Earlier discoveries remain in your library.');
                  }}
                >
                  New session
                </button>
              </div>
              {configuration &&
                (!configuration.configured || configuration.provider === 'local') && (
                  <div className="knowledge-setup">
                    <p>{configuration.message}</p>
                    <button
                      className="text-button"
                      onClick={() =>
                        void api<KnowledgeStatus>('/knowledge/status')
                          .then(setConfiguration)
                          .catch((error) => setError(error.message))
                      }
                    >
                      Recheck setup
                    </button>
                  </div>
                )}
              <p className="hint">
                Audio is not saved. Relevant speech excerpts, explanations, and sources stay in this
                browser’s library on this server.{' '}
                {configuration?.provider === 'local'
                  ? 'Speech and generation stay on your Mac; topic keywords go to public reference services. Transcripts appear after a pause.'
                  : 'Speech and research requests use OpenAI.'}
              </p>
            </section>
            <form className="knowledge-text-form" onSubmit={submit}>
              <label htmlFor="knowledge-text">Or add a passage</label>
              <div className="text-entry-row">
                <input
                  id="knowledge-text"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  maxLength={2000}
                  placeholder="What are people talking about?"
                />
                <button
                  className="secondary-button"
                  disabled={!text.trim() || !configuration?.configured || !!failed || queued >= 8}
                >
                  Explore
                  <ArrowRight size={16} />
                </button>
              </div>
            </form>
            <div className="knowledge-feed" aria-live="polite" aria-busy={processing}>
              {!!topics.length && (
                <div className="pending-topics">
                  {topics.map((topic) => (
                    <article className="knowledge-card pending" key={topic.keyword}>
                      <span className="eyebrow">IDENTIFIED IN YOUR CONVERSATION</span>
                      <h3>{topic.keyword}</h3>
                      <p>{topic.context}</p>
                      <span className="research-status">
                        <LoaderCircle size={14} className="spin" />
                        Finding industry and academic sources…
                      </span>
                    </article>
                  ))}
                </div>
              )}
              {notice && (
                <p className="knowledge-notice" role="status">
                  {notice}
                </p>
              )}
              {latestCards.map((card) => (
                <Card key={card.keyword} card={card} />
              ))}
              {!entries.length && !processing && !notice && (
                <div className="knowledge-empty">
                  <BookOpen size={30} />
                  <h3>A word can open a whole new world.</h3>
                  <p>
                    Discuss a topic—from semiconductor history to caching—and its key terms will
                    appear here with explanations. Follow the topic deeper and the cards will grow
                    with it.
                  </p>
                </div>
              )}
            </div>
          </div>
          <aside className="knowledge-aside">
            <section className="spark-card">
              <Lightbulb size={22} />
              <h3>Three sparks</h3>
              <p>Questions that take the conversation somewhere new.</p>
              {questions.length ? (
                <ol>
                  {questions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ol>
              ) : (
                <p className="muted">
                  Your first three questions will appear after a sourced discovery.
                </p>
              )}
            </section>
            <section className="flag-legend">
              <h3>A little fact checking</h3>
              {Object.entries(flagLabels).map(([mark, label]) => (
                <p key={mark}>
                  <strong>{mark}</strong>
                  <span>{label}</span>
                </p>
              ))}
              <small>
                More marks mean stronger evidence of inaccuracy, not greater severity. Each flag
                includes its sources; these are evidence judgments, not guarantees.
              </small>
            </section>
            <div className="library-note">
              <Check size={16} />
              <p>
                Discoveries accumulate in your library across sessions. This browser has its own
                library; clearing its cookie removes access.
              </p>
            </div>
          </aside>
        </div>
      ) : (
        <div className="knowledge-library">
          <div className="library-heading">
            <div>
              <h2>Your knowledge library</h2>
              <p>Saved discoveries, sources, and questions from your conversations.</p>
            </div>
            <label className="library-search">
              <Search size={17} />
              <input
                aria-label="Search saved knowledge"
                placeholder="Search loaded discoveries"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          {libraryLoading && <p role="status">Loading your library…</p>}
          {!libraryLoading && !filtered.length && (
            <div className="knowledge-empty">
              <BookOpen size={30} />
              <h3>
                {query
                  ? 'No matching discoveries.'
                  : 'Your next conversation starts your collection.'}
              </h3>
              <p>
                {query
                  ? 'Try another term or load earlier discoveries.'
                  : 'Knowledge cards are saved automatically once research finishes.'}
              </p>
            </div>
          )}
          {filtered.map((entry) => (
            <section className="library-entry" key={entry.id}>
              <header>
                <span>{new Date(entry.createdAt).toLocaleString()}</span>
                <button
                  className="icon-button"
                  aria-label={`Delete discovery about ${entry.cards[0]?.keyword}`}
                  onClick={() => void remove(entry)}
                >
                  <Trash2 size={17} />
                </button>
              </header>
              <blockquote className="library-excerpt">“{entry.text}”</blockquote>
              <div className="library-cards">
                {entry.cards.map((card) => (
                  <Card key={card.keyword} card={card} />
                ))}
              </div>
              <div className="library-questions">
                <h3>
                  <Lightbulb size={17} />
                  Three sparks
                </h3>
                <ol>
                  {entry.questions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ol>
              </div>
            </section>
          ))}
          {nextOffset !== null && (
            <button
              className="secondary-button"
              disabled={libraryLoading}
              onClick={() => void loadLibrary(nextOffset)}
            >
              Load earlier discoveries
            </button>
          )}
        </div>
      )}
    </section>
  );
}
