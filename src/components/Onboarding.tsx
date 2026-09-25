import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, MessageCircle, Send, Sparkles } from 'lucide-react';
import { languages, type Bootstrap, type MemoryInput, type Settings } from '../../shared/types';
import { api } from '../lib/api';

const questions = [
  'Let’s start with you. What would you like me to know about your background and the languages you speak?',
  'What do you enjoy? Tell me about the interests, activities, or work you’d like to bring into a conversation.',
  'Where will you use phier—social conversations, work, or dating? Are there any preferences or topics to avoid?',
  'What language should explanations use? Japanese pronunciation defaults to hiragana and katakana; you can ask for IPA instead.',
];
export function Onboarding({
  data,
  onComplete,
  notify,
}: {
  data: Bootstrap;
  onComplete(): Promise<void>;
  notify(text: string): void;
}) {
  const [answers, setAnswers] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ memories: MemoryInput[]; settings: Settings } | null>(
    null,
  );
  const [selected, setSelected] = useState<number[]>([]);
  const [complete, setComplete] = useState(false);
  async function submit(event?: FormEvent, skip = false) {
    event?.preventDefault();
    if ((!input.trim() && !skip) || busy) return;
    const next = [...answers, skip ? '(Skipped)' : input.trim()];
    setAnswers(next);
    setInput('');
    if (next.length === questions.length) {
      setBusy(true);
      try {
        const response = await api<{ memories: MemoryInput[]; settings: Settings }>('/onboarding', {
          text: next.join('\n'),
        });
        setReview(response);
        setSelected(response.memories.flatMap((m, i) => (m.sensitivity === 'normal' ? [i] : [])));
      } catch (error) {
        notify((error as Error).message);
        setAnswers(next.slice(0, -1));
        setInput(next.at(-1) || '');
      } finally {
        setBusy(false);
      }
    }
  }
  async function finish() {
    if (!review) return;
    setBusy(true);
    try {
      await api('/onboarding/complete', {
        ...review,
        memories: review.memories.filter((_, i) => selected.includes(i)),
      });
      await onComplete();
      setComplete(true);
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="profile-page page-section">
      <div className="page-heading">
        <div>
          <p className="eyebrow">A COMPANION THAT KNOWS YOU</p>
          <h1>Your profile</h1>
          <p>Your story stays yours, whichever language you speak.</p>
        </div>
        <span className="pill">
          <MessageCircle size={15} /> A short introduction
        </span>
      </div>
      {complete ? (
        <div className="completed-card">
          <span className="large-icon">
            <Check size={32} />
          </span>
          <h2>Nice to know you.</h2>
          <p>Your preferences are saved. You can edit every detail in Your memory.</p>
          <button
            className="secondary-button"
            onClick={() => {
              setComplete(false);
              setReview(null);
              setAnswers([]);
            }}
          >
            Tell phier a little more <ArrowRight size={16} />
          </button>
        </div>
      ) : review ? (
        <div className="onboarding-review">
          <h2>Does this sound like you?</h2>
          <p>
            Select the details you want to remember. Sensitive details are unchecked until you
            choose them.
          </p>
          {!review.memories.length && (
            <p className="notice">
              No durable facts were identified. You can still save your settings and add details in
              Your memory.
            </p>
          )}
          {review.memories.map((m, i) => (
            <label className="review-memory" key={i}>
              <input
                type="checkbox"
                checked={selected.includes(i)}
                onChange={(e) =>
                  setSelected((old) =>
                    e.target.checked ? [...old, i] : old.filter((n) => n !== i),
                  )
                }
              />
              <span>
                {m.content}
                <small>
                  {m.contexts.length ? m.contexts.join(', ') : 'Shared'}
                  {m.sensitivity === 'sensitive' ? ' · Sensitive' : ''}
                </small>
              </span>
            </label>
          ))}
          <div className="form-grid">
            <label>
              Explanation language
              <select
                value={review.settings.explanationLanguage}
                onChange={(e) =>
                  setReview({
                    ...review,
                    settings: {
                      ...review.settings,
                      explanationLanguage: e.target.value as Settings['explanationLanguage'],
                    },
                  })
                }
              >
                {Object.entries(languages).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Pronunciation
              <select
                value={review.settings.pronunciationMode}
                onChange={(e) =>
                  setReview({
                    ...review,
                    settings: {
                      ...review.settings,
                      pronunciationMode: e.target.value as Settings['pronunciationMode'],
                    },
                  })
                }
              >
                <option value="kana">Hiragana + katakana</option>
                <option value="ipa">IPA</option>
              </select>
            </label>
          </div>
          <label>
            Languages you speak
            <input
              value={review.settings.spokenLanguages}
              onChange={(e) =>
                setReview({
                  ...review,
                  settings: { ...review.settings, spokenLanguages: e.target.value },
                })
              }
            />
          </label>
          <div className="button-row">
            <button
              className="secondary-button"
              onClick={() => {
                setReview(null);
                setAnswers([]);
              }}
            >
              Start over
            </button>
            <button className="primary-button" disabled={busy} onClick={() => void finish()}>
              {busy ? 'Saving…' : 'Save my profile'}
              <Check size={17} />
            </button>
          </div>
        </div>
      ) : (
        <div className="onboarding-chat">
          {data.provider === 'mock' && (
            <div className="notice">
              Sample mode recognizes a small set of explicit details in English, such as “I enjoy
              tennis” or “I speak Mandarin.” Cloud mode supports broader conversation.
            </div>
          )}
          {questions.slice(0, Math.min(answers.length + 1, questions.length)).map((q, i) => (
            <div key={q}>
              <div className="chat-bubble assistant">
                <span className="chat-avatar">
                  <Sparkles size={17} />
                </span>
                <p>{q}</p>
              </div>
              {answers[i] && (
                <div className="chat-bubble user">
                  <p>{answers[i]}</p>
                </div>
              )}
            </div>
          ))}
          {busy ? (
            <p className="muted">Getting to know you…</p>
          ) : (
            <form className="chat-input" onSubmit={submit}>
              <textarea
                aria-label="Your introduction"
                placeholder="Tell me in your own words…"
                value={input}
                maxLength={800}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void submit();
                  }
                }}
              />
              <button
                className="send-button"
                disabled={!input.trim()}
                aria-label="Send introduction"
              >
                <Send size={19} />
              </button>
            </form>
          )}
          {answers.length < questions.length && (
            <div className="onboarding-progress">
              <span>
                {answers.length + 1} of {questions.length} · You can skip any question
              </span>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void submit(undefined, true)}
              >
                Skip this question
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
