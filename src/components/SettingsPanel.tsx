import { AudioLines, Globe2, LockKeyhole, SlidersHorizontal } from 'lucide-react';
import { languages, type Bootstrap, type Settings } from '../../shared/types';
import { ConnectionPanel } from './ConnectionPanel';

export function SettingsPanel({
  data,
  update,
  refresh,
}: {
  data: Bootstrap;
  update(patch: Partial<Settings>): Promise<void>;
  refresh(): Promise<void>;
}) {
  const settings = data.settings;
  return (
    <section className="page-section settings-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">MAKE YOURSELF UNDERSTOOD</p>
          <h1>Preferences</h1>
          <p>A few adjustments for your way of speaking.</p>
        </div>
      </div>
      <ConnectionPanel data={data} refresh={refresh} />
      <div className="settings-card">
        <div className="settings-title">
          <Globe2 size={22} />
          <h2>Language & pronunciation</h2>
        </div>
        <div className="setting-row">
          <div>
            <h3>Incoming language</h3>
            <p>Japanese for this first version.</p>
          </div>
          <span className="pill">日本語 · Japanese</span>
        </div>
        <div className="setting-row">
          <div>
            <h3>Explanation language</h3>
            <p>Subtitles and the meaning of your reply.</p>
          </div>
          <select
            aria-label="Explanation language"
            value={settings.explanationLanguage}
            onChange={(e) =>
              void update({
                explanationLanguage: e.target.value as Settings['explanationLanguage'],
              })
            }
          >
            {Object.entries(languages).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="setting-row">
          <div>
            <h3>Japanese pronunciation</h3>
            <p>Kana by default. IPA when you prefer it.</p>
          </div>
          <select
            aria-label="Japanese pronunciation"
            value={settings.pronunciationMode}
            onChange={(e) =>
              void update({ pronunciationMode: e.target.value as Settings['pronunciationMode'] })
            }
          >
            <option value="kana">Hiragana + katakana</option>
            <option value="ipa">IPA</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <h3>Languages you speak</h3>
            <p>Used to choose easier-to-say phrasing.</p>
          </div>
          <input
            aria-label="Languages you speak"
            key={settings.spokenLanguages}
            defaultValue={settings.spokenLanguages}
            maxLength={200}
            onBlur={(e) => {
              if (e.target.value !== settings.spokenLanguages)
                void update({ spokenLanguages: e.target.value });
            }}
          />
        </div>
      </div>
      <div className="settings-card">
        <div className="settings-title">
          <SlidersHorizontal size={22} />
          <h2>Conversation rhythm</h2>
        </div>
        <div className="setting-row">
          <div>
            <h3>Pause before responding</h3>
            <p>Wait a little longer if you tend to pause mid-sentence.</p>
          </div>
          <label className="range-label">
            <output>{(settings.silenceMs / 1000).toFixed(2)}s</output>
            <input
              type="range"
              aria-label="Silence threshold"
              min={400}
              max={2000}
              step={50}
              value={settings.silenceMs}
              onChange={(e) => void update({ silenceMs: Number(e.target.value) })}
            />
          </label>
        </div>
        <div className="setting-row">
          <div>
            <h3>Noise threshold</h3>
            <p>Raise this if background noise triggers listening.</p>
          </div>
          <label className="range-label">
            <output>{settings.vadThreshold.toFixed(3)}</output>
            <input
              type="range"
              aria-label="Noise threshold"
              min={0.005}
              max={0.1}
              step={0.001}
              value={settings.vadThreshold}
              onChange={(e) => void update({ vadThreshold: Number(e.target.value) })}
            />
          </label>
        </div>
      </div>
      <div className="settings-card">
        <div className="settings-title">
          <LockKeyhole size={22} />
          <h2>Memory & privacy</h2>
        </div>
        <div className="setting-row">
          <div>
            <h3>Learn about me</h3>
            <p>Learn durable details from speech marked “My turn.”</p>
          </div>
          <button
            className={`switch ${settings.autoLearn ? 'on' : ''}`}
            role="switch"
            aria-checked={settings.autoLearn}
            aria-label="Automatically learn memories"
            onClick={() => void update({ autoLearn: !settings.autoLearn })}
          >
            <span />
          </button>
        </div>
        <p className="hint">
          Audio and full transcripts are not saved by phier. Personal memories are stored on this
          computer. During cloud conversations, audio and necessary text are sent to the configured
          provider; its retention policies also apply. Sensitive or conflicting learned details
          appear for review in Your memory.
        </p>
      </div>
    </section>
  );
}
