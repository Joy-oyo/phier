import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Brain,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  CircleHelp,
  Coffee,
  Copy,
  Heart,
  Languages,
  LoaderCircle,
  MessageCircle,
  Mic,
  Pause,
  Play,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import {
  contexts,
  languages,
  samples,
  tones,
  type Bootstrap,
  type Context,
  type Memory,
  type Settings,
  type Speaker,
  type TranslationText,
  type TurnResult,
} from '../shared/types';
import { api } from './lib/api';
import { Microphone, type Callbacks } from './lib/audio';
import { TrtcSession } from './lib/trtc';
import { MemoryPanel } from './components/MemoryPanel';
import { Onboarding } from './components/Onboarding';
import { SettingsPanel } from './components/SettingsPanel';
import { ConnectionPanel } from './components/ConnectionPanel';
import { MicrophoneTestWindow } from './components/MicrophoneTestWindow';

type View = 'conversation' | 'memory' | 'profile' | 'settings';
type Status = 'idle' | 'connecting' | 'listening' | 'processing' | 'ready' | 'error';
const contextIcons = { social: Coffee, professional: BriefcaseBusiness, dating: Heart };
const contextDescriptions = {
  social: 'Easy, everyday connections',
  professional: 'Meetings & new introductions',
  dating: 'A little more personal',
};
/** TRTC returns every transcript segment with its translations, so no round trip is needed. */
function pickTranslation(translations: TranslationText[] | undefined, language: string) {
  return translations?.find((item) => item.language === language)?.text;
}
const statusLabels: Record<Status, string> = {
  idle: 'Ready when you are',
  connecting: 'Connecting microphone',
  listening: 'Listening',
  processing: 'Finding your words',
  ready: 'Ready to speak',
  error: 'Connection needs attention',
};

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const dataRef = useRef<Bootstrap | null>(null);
  const [bootError, setBootError] = useState('');
  const [view, setView] = useState<View>('conversation');
  const [status, setStatus] = useState<Status>('idle');
  const [live, setLive] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [speaker, setSpeaker] = useState<Speaker>('partner');
  const speakerRef = useRef<Speaker>('partner');
  const turnSpeaker = useRef<Speaker>('partner');
  const [subtitle, setSubtitle] = useState('');
  const [provisional, setProvisional] = useState(false);
  const [result, setResult] = useState<TurnResult | null>(null);
  const [demo, setDemo] = useState(false);
  const [demoRunning, setDemoRunning] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [level, setLevel] = useState(0);
  const [recognizedSpeech, setRecognizedSpeech] = useState('');
  const [audioBytes, setAudioBytes] = useState(0);
  const [textInput, setTextInput] = useState('');
  const [correctedText, setCorrectedText] = useState('');
  const [details, setDetails] = useState(false);
  const [memoryDetails, setMemoryDetails] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const [subtitleLatency, setSubtitleLatency] = useState<number | null>(null);
  const [copyDone, setCopyDone] = useState(false);
  const mic = useRef<Microphone | TrtcSession | null>(null);
  const epoch = useRef(0);
  const running = useRef(false);
  const turnController = useRef<AbortController | null>(null);
  const partialController = useRef<AbortController | null>(null);
  const partialTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partialLatest = useRef('');
  const partialBusy = useRef(false);
  const partialVersion = useRef(0);
  const speechStarted = useRef(0);
  const silenceAt = useRef(0);
  const firstSubtitle = useRef(false);
  const recent = useRef<{ speaker: Speaker; text: string }[]>([]);
  const seenItems = useRef(new Set<string>());
  const trtcMode = useRef(false);
  const saveQueue = useRef(Promise.resolve());
  const demoTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const mounted = useRef(true);

  const notify = useCallback((message: string) => setToast(message), []);
  const bootstrap = useCallback(async () => {
    try {
      const response = await api<Bootstrap>('/bootstrap');
      if (!mounted.current) return;
      setData(response);
      dataRef.current = response;
      setBootError('');
    } catch (error) {
      setBootError((error as Error).message);
    }
  }, []);
  const refreshMemories = useCallback(async () => {
    const memories = await api<Memory[]>('/memories');
    if (!mounted.current) return;
    setData((old) => (old ? { ...old, memories } : old));
    if (dataRef.current) dataRef.current = { ...dataRef.current, memories };
  }, []);
  function cancelPartial() {
    partialVersion.current++;
    partialLatest.current = '';
    partialBusy.current = false;
    partialController.current?.abort();
    if (partialTimer.current) clearTimeout(partialTimer.current);
    partialTimer.current = null;
  }
  useEffect(() => {
    mounted.current = true;
    void bootstrap();
    return () => {
      mounted.current = false;
      epoch.current++;
      mic.current?.stop();
      turnController.current?.abort();
      cancelPartial();
      demoTimers.current.forEach(clearTimeout);
    };
  }, [bootstrap]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const timer = setInterval(() => void refreshMemories().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [refreshMemories]);

  async function updateSettings(patch: Partial<Settings>) {
    if (!dataRef.current) return;
    const previous = dataRef.current.settings;
    const settings = { ...previous, ...patch };
    dataRef.current = { ...dataRef.current, settings };
    setData(dataRef.current);
    mic.current?.update(settings);
    const task = saveQueue.current.then(async () => {
      await api('/settings', settings, 'PUT');
    });
    saveQueue.current = task.catch(() => {});
    try {
      await task;
    } catch (error) {
      notify((error as Error).message);
      await bootstrap();
    }
  }
  function setActiveSpeaker(next: Speaker) {
    speakerRef.current = next;
    setSpeaker(next);
    mic.current?.resetTurn();
    cancelPartial();
  }
  function stop() {
    epoch.current++;
    running.current = false;
    mic.current?.stop();
    mic.current = null;
    turnController.current?.abort();
    cancelPartial();
    demoTimers.current.forEach(clearTimeout);
    demoTimers.current = [];
    setLive(false);
    setDemoRunning(false);
    setStatus('idle');
    setLevel(0);
    setRecognizedSpeech('');
    setAudioBytes(0);
    setProvisional(false);
    setSubtitle('');
    setResult(null);
    setCorrectedText('');
    setTextInput('');
    setError('');
    setLatency(null);
    setSubtitleLatency(null);
    recent.current = [];
    seenItems.current.clear();
    void api('/session/end', {}).catch(() => {});
  }
  useEffect(() => {
    if (view !== 'conversation' && (live || demoRunning)) stop();
  }, [view, live, demoRunning]);
  async function runTurn(text: string, role: Speaker, isDemo = false) {
    if (running.current || !text.trim()) return;
    running.current = true;
    const generation = epoch.current;
    cancelPartial();
    setProvisional(false);
    setStatus('processing');
    setError('');
    setResult(null);
    const controller = new AbortController();
    turnController.current = controller;
    const started = silenceAt.current || performance.now();
    try {
      await saveQueue.current;
      const response = await api<TurnResult>(
        '/turn',
        { id: crypto.randomUUID(), text, speaker: role, demo: isDemo, recent: recent.current },
        'POST',
        controller.signal,
      );
      if (generation !== epoch.current) return;
      setSubtitle(response.translation);
      setResult(response);
      setCorrectedText(response.transcript);
      setStatus(response.reply ? 'ready' : 'listening');
      setLatency(Math.round(performance.now() - started));
      setMemoryDetails(false);
      recent.current = [...recent.current, { speaker: role, text }].slice(-4);
      if (mic.current) {
        setActiveSpeaker(role === 'partner' ? 'user' : 'partner');
        mic.current.resume();
      } else if (!response.reply) setStatus('idle');
      if (role === 'user')
        notify(
          dataRef.current?.settings.autoLearn
            ? 'Your words were received. Relevant personal details will appear in Your memory.'
            : 'Your words were received. Automatic memory learning is off.',
        );
    } catch (error) {
      if (controller.signal.aborted || generation !== epoch.current) return;
      const message = (error as Error).message;
      // With TRTC the transcript and its translation are already on screen. A missing
      // reply must not end the session the way it does on the speech-session path.
      if (trtcMode.current && mic.current) {
        notify(`Translation shown. Reply unavailable: ${message}`);
        setStatus('listening');
        mic.current.resume();
      } else {
        setError(message);
        setStatus('error');
        mic.current?.stop();
        mic.current = null;
        setLive(false);
      }
    } finally {
      if (generation === epoch.current) {
        running.current = false;
        setDemoRunning(false);
      }
    }
  }
  function queuePartial(text: string) {
    partialLatest.current = text;
    if (partialBusy.current || partialTimer.current) return;
    partialTimer.current = setTimeout(() => {
      partialTimer.current = null;
      void translatePartial();
    }, 650);
  }
  async function translatePartial() {
    if (!partialLatest.current || !dataRef.current) return;
    const text = partialLatest.current;
    partialLatest.current = '';
    partialBusy.current = true;
    const version = partialVersion.current;
    const controller = new AbortController();
    partialController.current = controller;
    try {
      const response = await api<{ translation: string }>(
        '/translate',
        { text, language: dataRef.current.settings.explanationLanguage },
        'POST',
        controller.signal,
      );
      if (version !== partialVersion.current) return;
      setSubtitle(response.translation);
      setProvisional(true);
      if (!firstSubtitle.current) {
        firstSubtitle.current = true;
        setSubtitleLatency(Math.round(performance.now() - speechStarted.current));
      }
    } catch (error) {
      if (!controller.signal.aborted && version === partialVersion.current) {
        setProvisional(false);
        setError(`Live subtitle translation failed: ${(error as Error).message}`);
      }
    } finally {
      if (version === partialVersion.current) {
        partialBusy.current = false;
        if (partialLatest.current) queuePartial(partialLatest.current);
      }
    }
  }
  async function startListening() {
    if (!dataRef.current?.liveAvailable) {
      setSetupOpen(true);
      requestAnimationFrame(() => {
        document
          .getElementById('microphone-test-launcher')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.getElementById('microphone-test-launcher')?.focus({ preventScroll: true });
      });
      return;
    }
    epoch.current++;
    setDemo(false);
    setError('');
    setStatus('connecting');
    setLive(true);
    setResult(null);
    setSubtitle('');
    setRecognizedSpeech('');
    setAudioBytes(0);
    setLatency(null);
    setSubtitleLatency(null);
    seenItems.current.clear();
    setActiveSpeaker('partner');
    const generation = epoch.current;
    const settings = dataRef.current.settings;
    trtcMode.current = Boolean(dataRef.current.trtc?.configured);
    const callbacks: Callbacks = {
      onReady: () => {
        if (generation === epoch.current) setStatus('listening');
      },
      onSpeech: () => {
        if (generation !== epoch.current) return;
        turnSpeaker.current = speakerRef.current;
        speechStarted.current = performance.now();
        firstSubtitle.current = false;
        silenceAt.current = 0;
        setSubtitle('');
        setRecognizedSpeech('');
        setProvisional(true);
        setStatus('listening');
        if (turnSpeaker.current === 'partner') setResult(null);
      },
      onCommit: () => {
        silenceAt.current = performance.now();
        setStatus('processing');
      },
      onLevel: (value) => {
        if (generation === epoch.current) setLevel(value);
      },
      onAudio: (bytes) => {
        if (generation === epoch.current) setAudioBytes((total) => total + bytes);
      },
      onPartial: (_id, text, translations) => {
        if (generation !== epoch.current) return;
        setRecognizedSpeech(text);
        const translated = pickTranslation(
          translations,
          dataRef.current?.settings.explanationLanguage ?? 'en',
        );
        if (translated) {
          setSubtitle(translated);
          setProvisional(true);
          if (!firstSubtitle.current) {
            firstSubtitle.current = true;
            setSubtitleLatency(Math.round(performance.now() - speechStarted.current));
          }
          return;
        }
        queuePartial(text);
      },
      onFinal: (id, text) => {
        if (generation !== epoch.current || seenItems.current.has(id)) return;
        seenItems.current.add(id);
        setRecognizedSpeech(text);
        if (!text.trim()) {
          mic.current?.resume();
          setStatus('listening');
          notify('No clear speech detected. Please try again.');
          return;
        }
        void runTurn(text, turnSpeaker.current);
      },
      onError: (message) => {
        if (generation !== epoch.current) return;
        cancelPartial();
        setLive(false);
        setError(message);
        setStatus('error');
        mic.current = null;
      },
    };
    const capture = dataRef.current.trtc?.configured
      ? new TrtcSession(settings.explanationLanguage, callbacks)
      : new Microphone(settings, callbacks);
    mic.current = capture;
    await capture.start();
  }
  async function playSample(sample: (typeof samples)[number]) {
    if (running.current || demoRunning) return;
    stop();
    const generation = epoch.current;
    setDemo(true);
    setDemoRunning(true);
    setStatus('listening');
    setProvisional(true);
    setActiveSpeaker('partner');
    await updateSettings({ context: sample.context });
    try {
      const translated = await api<{ translation: string }>('/translate', {
        text: sample.text,
        language: dataRef.current!.settings.explanationLanguage,
        demo: true,
      });
      if (generation !== epoch.current) return;
      const words = translated.translation.includes(' ')
        ? translated.translation.split(' ')
        : [...translated.translation];
      const joiner = translated.translation.includes(' ') ? ' ' : '';
      words.forEach((_, i) => {
        const timer = setTimeout(
          () => {
            if (generation === epoch.current) setSubtitle(words.slice(0, i + 1).join(joiner));
          },
          150 * (i + 1),
        );
        demoTimers.current.push(timer);
      });
      const end = setTimeout(
        () => {
          if (generation !== epoch.current) return;
          silenceAt.current = performance.now();
          void runTurn(sample.text, 'partner', true);
        },
        (words.length + 2) * 150,
      );
      demoTimers.current.push(end);
    } catch (error) {
      setError((error as Error).message);
      setStatus('error');
      setDemoRunning(false);
    }
  }
  async function submitText(event: FormEvent) {
    event.preventDefault();
    setDemo(false);
    silenceAt.current = performance.now();
    await runTurn(textInput, speaker);
    setTextInput('');
  }
  async function changePronunciation(mode: Settings['pronunciationMode']) {
    await updateSettings({ pronunciationMode: mode });
    if (!result?.reply) return;
    const id = result.id;
    try {
      const response = await api<{ pronunciation: string }>('/pronounce', {
        text: result.reply.responseText,
        mode,
        demo,
      });
      setResult((old) =>
        old?.id === id && old.reply && dataRef.current?.settings.pronunciationMode === mode
          ? {
              ...old,
              reply: {
                ...old.reply,
                pronunciation: response.pronunciation,
                pronunciationMode: mode,
              },
            }
          : old,
      );
    } catch (error) {
      notify((error as Error).message);
    }
  }
  if (!data)
    return (
      <div className="loading-page">
        <div className="brand">
          <AudioLines /> phier<span>®</span>
        </div>
        {bootError ? (
          <>
            <p>{bootError}</p>
            <button className="primary-button" onClick={() => void bootstrap()}>
              Try again
            </button>
          </>
        ) : (
          <p>Getting things ready…</p>
        )}
      </div>
    );
  const settings = data.settings;
  const activeMemories = data.memories.filter((m) => m.status === 'active');
  const usedMemories = data.memories.filter((m) => result?.reply?.memoryIdsUsed.includes(m.id));
  const busy = status === 'processing' || status === 'connecting' || demoRunning;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" aria-label="phier home" onClick={() => setView('conversation')}>
          <span className="brand-symbol">
            <AudioLines size={27} />
          </span>
          phier<span className="brand-dot">®</span>
        </button>
        <span className="sidebar-label">YOUR COMPANION</span>
        <nav aria-label="Main navigation">
          {(
            [
              { id: 'conversation', name: 'Conversation', icon: AudioLines },
              { id: 'memory', name: 'Your memory', icon: Brain },
              { id: 'profile', name: 'Your profile', icon: UserRound },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? 'selected' : ''}`}
              aria-label={item.name}
              aria-current={view === item.id ? 'page' : undefined}
              onClick={() => setView(item.id)}
            >
              <item.icon size={20} />
              <span>{item.name}</span>
              {item.id === 'memory' && !!activeMemories.length && (
                <span className="count">{activeMemories.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <ShieldCheck size={20} />
            <strong>Personal stays personal.</strong>
            <p>
              Your audio isn’t saved.
              <br />
              Your memories are yours to edit.
            </p>
          </div>
          <button
            className={`nav-item ${view === 'settings' ? 'selected' : ''}`}
            onClick={() => setView('settings')}
          >
            <Settings2 size={19} /> Preferences
          </button>
          <div className="version-line">
            <span className="mini-mark">p</span>
            <span>Made for connection</span>
            <span>0.1</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="breadcrumb">
            Your space <ChevronRight size={15} />{' '}
            <span>
              {view === 'conversation'
                ? 'Conversation'
                : view === 'memory'
                  ? 'Memory'
                  : view === 'profile'
                    ? 'Profile'
                    : 'Preferences'}
            </span>
          </span>
          <button
            className={`connection-status ${data.liveAvailable ? 'configured' : ''}`}
            onClick={() => setView('settings')}
          >
            <span />
            {data.provider === 'mock'
              ? 'Development fixtures'
              : data.liveAvailable
                ? 'Live verified'
                : data.connection.configured
                  ? 'Check connection'
                  : 'API key needed'}
            <ArrowUpRight size={14} />
          </button>
        </header>
        <main>
          {view === 'conversation' && (
            <section className="conversation-page">
              <div className="page-heading">
                <div>
                  <p className="eyebrow">LESS TRANSLATING. MORE CONNECTING.</p>
                  <h1>Be part of the conversation.</h1>
                  <p>Understand their words. Find yours.</p>
                </div>
                <div className="language-route">
                  <span className="japan-flag" />
                  <span>Japanese</span>
                  <ArrowRight size={16} />
                  <button onClick={() => setView('settings')}>
                    {languages[settings.explanationLanguage]}
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
              {!live && (setupOpen || (!data.liveAvailable && !data.demoEnabled)) && (
                <div id="listening-setup">
                  <ConnectionPanel data={data} refresh={bootstrap} />
                  <section className="settings-card" aria-label="Start live conversation">
                    <h2>3. Start your live conversation</h2>
                    <p>
                      {data.liveAvailable
                        ? 'Ready. Starting closes the local test and sends microphone audio to the speech service for live captions and replies.'
                        : 'You can test your microphone now. Live subtitles and replies require the cloud checks above to pass.'}
                    </p>
                    <button
                      className="primary-button"
                      disabled={!data.liveAvailable}
                      onClick={() => void startListening()}
                    >
                      Start live conversation
                    </button>
                  </section>
                </div>
              )}
              <div className="conversation-layout">
                <div className="conversation-main">
                  <section
                    className={`listening-card ${live || demoRunning ? 'is-listening' : ''}`}
                    aria-label="Incoming subtitles"
                  >
                    <div className="card-top">
                      <span className="surface-label">
                        <span className={`live-dot ${live || demoRunning ? 'active' : ''}`} />
                        {demo
                          ? 'SAMPLE'
                          : live
                            ? speaker === 'partner'
                              ? 'THEIR WORDS'
                              : 'YOUR WORDS'
                            : 'LIVE'}
                      </span>
                      <span className="language-small">
                        日本語 <span>/</span> {settings.explanationLanguage.toUpperCase()}
                      </span>
                    </div>
                    <div className="subtitle-area" aria-live="polite" aria-atomic="true">
                      {subtitle || recognizedSpeech ? (
                        <>
                          {subtitle && (
                            <p className="subtitle-text" lang={settings.explanationLanguage}>
                              {subtitle}
                              {provisional && <span className="caret" />}
                            </p>
                          )}
                          {recognizedSpeech && (
                            <p className="source-transcript" lang="ja">
                              {recognizedSpeech}
                            </p>
                          )}
                        </>
                      ) : (
                        <div className="listen-placeholder">
                          <div
                            className={`waveform ${demoRunning ? 'animated' : ''}`}
                            aria-hidden="true"
                          >
                            {Array.from({ length: 27 }, (_, i) => (
                              <i
                                key={i}
                                style={
                                  {
                                    '--bar-height': `${live ? 3 + Math.min(1, level * 18) * (12 + Math.sin(i * 0.9) ** 2 * 32) : 3}px`,
                                    '--delay': `${i * -0.08}s`,
                                    '--level': Math.max(0.25, Math.min(2.5, level * 35)),
                                  } as CSSProperties
                                }
                              />
                            ))}
                          </div>
                          <h2>
                            {status === 'connecting'
                              ? 'Getting ready…'
                              : live
                                ? 'Listening…'
                                : 'Start a live conversation'}
                          </h2>
                        </div>
                      )}
                    </div>
                    {live && (
                      <div className="stream-diagnostics">
                        <meter
                          min={0}
                          max={1}
                          value={Math.min(1, level * 12)}
                          aria-label="Microphone input level"
                        />
                        <span>{(audioBytes / 48000).toFixed(1)}s</span>
                      </div>
                    )}
                    <div className="listen-footer">
                      <span>
                        {busy ? (
                          <LoaderCircle className="spin" size={15} />
                        ) : (
                          <AudioLines size={15} />
                        )}
                        {statusLabels[status]}
                      </span>
                      <span className="listen-privacy">
                        <ShieldCheck size={14} /> Audio not saved
                      </span>
                    </div>
                  </section>
                  <div className="flow-divider">
                    <span />
                    <ArrowDown size={16} />
                    <span />
                  </div>
                  <section
                    className={`reply-card ${result?.reply ? 'has-reply' : ''}`}
                    aria-label="Suggested response"
                  >
                    <div className="card-top">
                      <span className="surface-label">
                        <Sparkles size={16} /> YOUR NEXT WORDS
                      </span>
                      <div className="format-toggle" aria-label="Pronunciation format">
                        <button
                          aria-pressed={settings.pronunciationMode === 'kana'}
                          className={settings.pronunciationMode === 'kana' ? 'active' : ''}
                          disabled={busy}
                          onClick={() => void changePronunciation('kana')}
                        >
                          かな
                        </button>
                        <button
                          aria-pressed={settings.pronunciationMode === 'ipa'}
                          className={settings.pronunciationMode === 'ipa' ? 'active' : ''}
                          disabled={busy}
                          onClick={() => void changePronunciation('ipa')}
                        >
                          IPA
                        </button>
                      </div>
                    </div>
                    <div className="reply-content" aria-live="polite">
                      {result?.reply ? (
                        <>
                          <p
                            className={`pronunciation ${result.reply.pronunciationMode === 'ipa' ? 'ipa' : ''}`}
                            lang={result.reply.pronunciationMode === 'kana' ? 'ja' : undefined}
                          >
                            {result.reply.pronunciation}
                          </p>
                          <p className="reply-meaning" lang={settings.explanationLanguage}>
                            {result.reply.meaning}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="reply-empty">
                            {status === 'processing'
                              ? 'Finding a natural way to say it…'
                              : 'Your reply will appear here.'}
                          </p>
                          <p className="reply-hint">
                            A short response, with pronunciation and meaning.
                          </p>
                        </>
                      )}
                    </div>
                    <div className="reply-footer">
                      <button
                        className="memory-link"
                        disabled={!usedMemories.length}
                        onClick={() => setMemoryDetails(!memoryDetails)}
                      >
                        <Brain size={16} />
                        {usedMemories.length
                          ? `Shaped by ${usedMemories.length} ${usedMemories.length === 1 ? 'memory' : 'memories'}`
                          : 'Personalized when a memory fits'}
                        {usedMemories.length > 0 && <ChevronRight size={13} />}
                      </button>
                      {result?.reply && (
                        <button
                          className="icon-button"
                          aria-label="Copy suggested response"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(
                                `${result.reply!.pronunciation}\n${result.reply!.meaning}`,
                              );
                              setCopyDone(true);
                              setTimeout(() => setCopyDone(false), 2000);
                            } catch {
                              notify('Copy is unavailable in this browser.');
                            }
                          }}
                        >
                          {copyDone ? <Check size={17} /> : <Copy size={17} />}
                        </button>
                      )}
                    </div>
                    {memoryDetails && (
                      <div className="used-memories">
                        {usedMemories.map((m) => (
                          <span key={m.id}>{m.content}</span>
                        ))}
                      </div>
                    )}
                  </section>
                  {error && (
                    <div className="error-banner" role="alert">
                      <CircleHelp size={18} />
                      <span>{error}</span>
                      <button
                        className="icon-button"
                        aria-label="Dismiss error"
                        onClick={() => setError('')}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  )}
                  <div className="session-controls">
                    <button
                      className={`primary-button listen-button ${live || demoRunning ? 'recording' : ''}`}
                      onClick={() => (live || demoRunning ? stop() : void startListening())}
                      disabled={status === 'processing' && !live && !demoRunning}
                    >
                      {live || demoRunning ? <Pause size={18} /> : <Mic size={18} />}
                      {live || demoRunning
                        ? 'End session'
                        : data.liveAvailable
                          ? 'Start listening'
                          : 'Set up live listening'}
                    </button>
                    <div className="speaker-toggle" aria-label="Who is speaking">
                      <button
                        aria-pressed={speaker === 'partner'}
                        disabled={busy}
                        onClick={() => setActiveSpeaker('partner')}
                        className={speaker === 'partner' ? 'active' : ''}
                      >
                        <MessageCircle size={15} />
                        Their turn
                      </button>
                      <button
                        aria-pressed={speaker === 'user'}
                        disabled={busy}
                        onClick={() => setActiveSpeaker('user')}
                        className={speaker === 'user' ? 'active' : ''}
                      >
                        <UserRound size={15} />
                        My turn
                      </button>
                    </div>
                  </div>
                  <p className="turn-hint">
                    {speaker === 'user'
                      ? 'Your words can teach phier about you. No reply is generated during your turn.'
                      : 'Only speech marked “My turn” can become a personal memory.'}
                  </p>
                  {data.demoEnabled && (
                    <div className="sample-section">
                      <div className="section-mini-heading">
                        <h3>Try a conversation</h3>
                        <span>Sample · no microphone needed</span>
                      </div>
                      <div className="sample-grid">
                        {samples.map((sample) => (
                          <button
                            className="sample-button"
                            key={sample.id}
                            disabled={busy || live}
                            onClick={() => void playSample(sample)}
                          >
                            <Play size={14} />
                            <span>{sample.title}</span>
                            <ArrowUpRight size={14} />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <details className="text-entry">
                    <summary>Use text instead</summary>
                    <form onSubmit={submitText}>
                      <label htmlFor="turn-text">
                        {speaker === 'user' ? 'Your own words' : 'Their Japanese words'}
                      </label>
                      <div className="text-entry-row">
                        <input
                          id="turn-text"
                          value={textInput}
                          onChange={(e) => setTextInput(e.target.value)}
                          maxLength={2000}
                          placeholder={
                            speaker === 'user'
                              ? 'Type your own words'
                              : 'Type words you actually heard'
                          }
                        />
                        <button
                          className="secondary-button"
                          disabled={busy || live || !textInput.trim()}
                        >
                          Send <ArrowRight size={16} />
                        </button>
                      </div>
                      <p className="hint">
                        {data.provider === 'mock'
                          ? 'Sample mode supports the four Japanese examples and simple personal statements in English.'
                          : 'Send the words as spoken. The selected speaker determines whether to suggest a reply or learn about you.'}
                      </p>
                    </form>
                  </details>
                  {result && (
                    <details
                      className="technical-details"
                      open={details}
                      onToggle={(e) => setDetails(e.currentTarget.open)}
                    >
                      <summary>Transcript & timing</summary>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          silenceAt.current = performance.now();
                          void runTurn(correctedText, result.speaker, demo);
                        }}
                      >
                        <label>
                          Correct the recognized words
                          <textarea
                            value={correctedText}
                            maxLength={2000}
                            onChange={(e) => setCorrectedText(e.target.value)}
                          />
                        </label>
                        <button
                          className="text-button"
                          disabled={busy || live || !correctedText.trim()}
                        >
                          Use corrected text <ArrowRight size={15} />
                        </button>
                      </form>
                      <dl>
                        <div>
                          <dt>Translation</dt>
                          <dd>{result.metrics.translationMs} ms</dd>
                        </div>
                        <div>
                          <dt>Reply</dt>
                          <dd>{result.metrics.generationMs} ms</dd>
                        </div>
                        <div>
                          <dt>After turn end</dt>
                          <dd>{latency} ms</dd>
                        </div>
                        {subtitleLatency !== null && (
                          <div>
                            <dt>First subtitle</dt>
                            <dd>{subtitleLatency} ms</dd>
                          </div>
                        )}
                      </dl>
                      {demo && (
                        <p className="hint">
                          Sample timings use local fixtures and do not represent cloud latency.
                        </p>
                      )}
                    </details>
                  )}
                </div>
                <aside className="context-panel">
                  {!live && <MicrophoneTestWindow />}
                  <div className="context-card">
                    <div className="panel-heading">
                      <span className="small-icon">
                        <Settings2 size={18} />
                      </span>
                      <h2>Set the scene</h2>
                    </div>
                    <p className="muted">A different moment, the same you.</p>
                    <div className="context-options">
                      {contexts.map((context) => {
                        const Icon = contextIcons[context];
                        return (
                          <button
                            key={context}
                            className={`context-option ${settings.context === context ? 'active' : ''}`}
                            aria-pressed={settings.context === context}
                            onClick={() => void updateSettings({ context })}
                          >
                            <Icon size={19} />
                            <span>
                              <strong>
                                {context === 'professional'
                                  ? 'Professional'
                                  : context === 'social'
                                    ? 'Social'
                                    : 'Dating'}
                              </strong>
                              <small>{contextDescriptions[context]}</small>
                            </span>
                            <span className="radio-circle">
                              {settings.context === context && <span />}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="tone-label">
                      <h3>Your tone</h3>
                      <span>Saved for this setting</span>
                    </div>
                    <div className="tone-options">
                      {tones.map((tone) => (
                        <button
                          key={tone}
                          aria-pressed={settings.contextTones[settings.context] === tone}
                          className={
                            settings.contextTones[settings.context] === tone ? 'active' : ''
                          }
                          onClick={() =>
                            void updateSettings({
                              contextTones: { ...settings.contextTones, [settings.context]: tone },
                            })
                          }
                        >
                          {tone}
                        </button>
                      ))}
                    </div>
                    <p className="context-note">Changes apply to your next response.</p>
                  </div>
                  <div className="about-card">
                    <div className="panel-heading">
                      <Brain size={20} />
                      <h2>A little about you</h2>
                    </div>
                    {activeMemories.length ? (
                      <>
                        <div className="memory-preview">
                          {activeMemories.slice(0, 3).map((m) => (
                            <p key={m.id}>
                              <span />
                              {m.content}
                            </p>
                          ))}
                        </div>
                        <button className="text-button" onClick={() => setView('memory')}>
                          View your memory <ArrowUpRight size={15} />
                        </button>
                      </>
                    ) : (
                      <>
                        <p>
                          Tell phier about your world. Your interests, background, and preferences
                          will help shape your replies.
                        </p>
                        <button className="text-button" onClick={() => setView('profile')}>
                          Let’s get acquainted <ArrowUpRight size={16} />
                        </button>
                      </>
                    )}
                  </div>
                  <div className="quiet-note">
                    <Languages size={20} />
                    <p>
                      Your response stays short.
                      <br />
                      Your meaning stays intact.
                    </p>
                  </div>
                </aside>
              </div>
            </section>
          )}
          {view === 'memory' && (
            <MemoryPanel memories={data.memories} refresh={refreshMemories} notify={notify} />
          )}
          {view === 'profile' && <Onboarding data={data} onComplete={bootstrap} notify={notify} />}
          {view === 'settings' && (
            <SettingsPanel data={data} update={updateSettings} refresh={bootstrap} />
          )}
        </main>
        <footer className="workspace-footer">
          <span>phier — a little closer.</span>
          <span>Japanese today. More connections tomorrow.</span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
