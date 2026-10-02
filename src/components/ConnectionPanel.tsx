import { useState } from 'react';
import { AudioLines, ArrowUpRight, Check, CircleHelp, KeyRound, LoaderCircle } from 'lucide-react';
import type { Bootstrap, ConnectionStatus } from '../../shared/types';
import { api } from '../lib/api';

export function ConnectionPanel({ data, refresh }: { data: Bootstrap; refresh(): Promise<void> }) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const connection = data.connection;
  async function check() {
    setChecking(true);
    setError('');
    try {
      const result = await api<ConnectionStatus>('/connection/check', {});
      await refresh();
      if (!result.configured)
        setError(
          'No API key found yet. Save GROQ_API_KEY in the project’s .env file, then check again.',
        );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setChecking(false);
    }
  }
  return (
    <section className="settings-card connection-card live-setup" aria-label="Live provider setup">
      <div className="settings-title">
        <AudioLines size={22} />
        <h2>2. Check {data.provider === 'local' ? 'local models' : 'cloud connection'}</h2>
        <span className="tag">
          {data.liveAvailable
            ? 'Verified'
            : connection.configured
              ? 'Needs verification'
              : 'API key needed'}
        </span>
      </div>
      <p>
        {data.liveAvailable
          ? `${data.provider === 'local' ? 'Local' : data.provider === 'groq' ? 'Groq' : 'OpenAI'} response generation and the speech provider passed live checks.`
          : data.provider === 'local'
            ? 'Ollama generates replies and whisper.cpp recognizes speech on your Mac. No API credits are required. Transcripts appear after short pauses.'
            : 'Connect a free Groq API key for replies. TRTC continues to handle Japanese speech and live translation.'}
      </p>
      {(['text', 'memory', 'speech'] as const).some(
        (name) => connection[name].status === 'error',
      ) && (
        <p className="error-text" role="alert">
          {data.provider === 'local'
            ? 'Local models need attention.'
            : 'Cloud connection needs attention.'}{' '}
          Your microphone can still be tested locally. Review the service message below, update that
          provider, then check again.{' '}
          {data.provider === 'openai' && (
            <a
              href="https://platform.openai.com/settings/organization/billing/"
              target="_blank"
              rel="noreferrer"
            >
              add API credits
            </a>
          )}
        </p>
      )}
      {!connection.configured && (
        <ol className="setup-steps">
          <li>
            <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">
              Create a free Groq API key <ArrowUpRight size={14} />
            </a>{' '}
            in GroqCloud.
          </li>
          <li>
            Save the key in <code>phier/.env</code> on this computer. Keep it out of this chat and
            out of browser code.<pre>GROQ_API_KEY=your-secret-key</pre>
          </li>
          <li>
            Choose <strong>Check connection</strong>. Phier reloads the file without restarting.
          </li>
        </ol>
      )}
      <div className="provider-checks">
        {(['text', 'memory', 'speech'] as const).map((name) => {
          const state = connection[name];
          return (
            <div key={name} className={`provider-check ${state.status}`}>
              <span className="check-icon">
                {checking ? (
                  <LoaderCircle size={17} className="spin" />
                ) : state.status === 'ready' ? (
                  <Check size={17} />
                ) : state.status === 'error' ? (
                  <CircleHelp size={17} />
                ) : (
                  <KeyRound size={17} />
                )}
              </span>
              <div>
                <strong>
                  {name === 'text'
                    ? 'Translation & replies'
                    : name === 'memory'
                      ? 'Personal memory'
                      : connection.provider === 'local'
                        ? 'Speech after pauses'
                        : 'Streaming speech'}
                </strong>
                <p>{checking ? 'Checking live service…' : state.message}</p>
                <code>{connection.models[name]}</code>
              </div>
              {state.latencyMs !== null && !checking && (
                <span className="check-timing">{(state.latencyMs / 1000).toFixed(1)}s</span>
              )}
            </div>
          );
        })}
      </div>
      <button className="primary-button" onClick={() => void check()} disabled={checking}>
        {checking ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{' '}
        {checking ? 'Checking…' : 'Check connection'}
      </button>
      <p className="hint">
        {data.provider === 'local'
          ? 'This checks local generation with a built-in phrase and connects to local speech recognition. No API charges, saved memories, or microphone audio are involved.'
          : 'This makes small live API requests using built-in test phrases, with no saved personal memories or microphone audio. Free-tier limits or charges may apply. Your key stays on the server.'}
      </p>
      {connection.checkedAt && (
        <p className="hint">Last checked {new Date(connection.checkedAt).toLocaleString()}.</p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
