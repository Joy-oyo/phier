import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { defaultSettings } from '../../shared/types';
import { Microphone } from '../lib/audio';

// Runs the same PCM capture path as live listening, with networking disabled.
export function MicrophoneCheck({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<'idle' | 'requesting' | 'active' | 'stopped' | 'error'>(
    'idle',
  );
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState(false);
  const [bytes, setBytes] = useState(0);
  const [error, setError] = useState('');
  const [device, setDevice] = useState('');
  const generation = useRef(0);
  const capture = useRef<Microphone | null>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (state === 'requesting' || state === 'active')
      stopButton.current?.focus({ preventScroll: true });
  }, [state]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function release() {
    generation.current++;
    clearTimeout(timer.current);
    capture.current?.stop();
    capture.current = null;
  }
  useEffect(() => () => release(), []);
  function stop() {
    release();
    setLevel(0);
    setState('stopped');
  }
  function start() {
    release();
    const token = generation.current;
    setState('requesting');
    setError('');
    setHeard(false);
    setBytes(0);
    setLevel(0);
    const current = new Microphone(
      defaultSettings,
      {
        onReady() {
          if (token !== generation.current) return;
          setState('active');
          timer.current = setTimeout(stop, 30_000);
        },
        onDevice(label) {
          if (token === generation.current) setDevice(label);
        },
        onLevel(rms) {
          if (token !== generation.current) return;
          setLevel(Math.min(1, rms * 12));
          if (rms > 0.008) setHeard(true);
        },
        onAudio(count) {
          if (token === generation.current) setBytes((total) => total + count);
        },
        onError(message) {
          if (token !== generation.current) return;
          release();
          setLevel(0);
          setState('error');
          setError(message);
        },
        onSpeech() {},
        onCommit() {},
        onPartial() {},
        onFinal() {},
      },
      { localOnly: true },
    );
    capture.current = current;
    void current.start();
  }
  return (
    <section
      className={`settings-card ${compact ? 'microphone-check-compact' : ''}`}
      aria-label="Microphone setup"
    >
      {!compact && (
        <>
          <div className="settings-title">
            <Mic size={22} />
            <h3>Allow & test your microphone</h3>
          </div>
          <p>
            This test works without API credits. Sound stays in this browser: nothing is uploaded,
            saved, or played back.
          </p>
        </>
      )}
      {compact && (
        <p className="hint">
          Local-only · 30-second test · no uploads. Allow microphone access when prompted.
        </p>
      )}
      {!compact && (
        <p className="hint">
          Your browser controls permission. Click below, then choose Allow if prompted. If already
          allowed, the test starts immediately. Use HTTPS or localhost; microphone access cannot be
          enabled silently.
        </p>
      )}
      <div className="session-controls">
        <button
          id="microphone-setup-action"
          className="primary-button"
          onClick={start}
          disabled={state === 'active' || state === 'requesting'}
        >
          <Mic size={17} />
          {state === 'requesting'
            ? 'Waiting for microphone permission…'
            : 'Allow microphone & test'}
        </button>
        {(state === 'active' || state === 'requesting') && (
          <button ref={stopButton} className="secondary-button" onClick={stop}>
            <Square size={16} />
            {state === 'requesting' ? 'Cancel microphone request' : 'Stop microphone test'}
          </button>
        )}
      </div>
      <p role="status">
        {state === 'active'
          ? `${device} · ${heard ? 'Sound detected' : 'Speak now and watch the meter'} · stops after 30 seconds`
          : state === 'stopped'
            ? 'Microphone test stopped. No audio is being captured.'
            : state === 'idle'
              ? 'Microphone not started.'
              : ''}
      </p>
      <meter
        aria-label="Local microphone level"
        min={0}
        max={1}
        value={level}
        style={{ width: '100%' }}
      />
      {state === 'active' && (
        <p className="hint" data-testid="capture-format">
          {(bytes / 48000).toFixed(1)} seconds captured locally · 24 kHz mono PCM16 · 20 ms frames
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <details className="microphone-help">
        <summary>Microphone help</summary>
        <p className="hint">
          If no permission prompt appears, open{' '}
          <a href={location.origin} target="_blank" rel="noreferrer">
            Phier in a separate browser tab
          </a>{' '}
          or copy its address into Chrome or Safari. To change microphones, select the input in your
          browser or system sound settings.
        </p>
      </details>
    </section>
  );
}
