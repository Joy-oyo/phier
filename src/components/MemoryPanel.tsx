import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, Brain, Check, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { contexts, type Context, type Memory, type MemoryInput } from '../../shared/types';
import { api } from '../lib/api';

export function MemoryPanel({
  memories,
  refresh,
  notify,
}: {
  memories: Memory[];
  refresh(): Promise<void>;
  notify(message: string): void;
}) {
  const [filter, setFilter] = useState<'all' | 'shared' | Context>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Memory | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Memory | null>(null);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (editing) dialog.current?.showModal();
    else dialog.current?.close();
  }, [editing]);
  useEffect(() => {
    if (deleting) deleteDialog.current?.showModal();
    else deleteDialog.current?.close();
  }, [deleting]);
  const shown = memories.filter(
    (m) =>
      (filter === 'all' ||
        (filter === 'shared' ? !m.contexts.length : m.contexts.includes(filter))) &&
      m.content.toLowerCase().includes(search.toLowerCase()),
  );
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const value: MemoryInput = {
      content: String(form.get('content')),
      key: editing && editing !== 'new' ? editing.key : `manual.${crypto.randomUUID()}`,
      category: form.get('category') as MemoryInput['category'],
      contexts: form.getAll('contexts') as Context[],
      sensitivity: form.get('sensitivity') === 'on' ? 'sensitive' : 'normal',
      confidence: 1,
    };
    try {
      await api(
        editing === 'new' ? '/memories' : `/memories/${(editing as Memory).id}`,
        value,
        editing === 'new' ? 'POST' : 'PUT',
      );
      await refresh();
      setEditing(null);
      notify('Memory saved.');
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="page-section">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PERSONAL, IN EVERY LANGUAGE</p>
          <h1>Your memory</h1>
          <p>Small details that make a response sound like you.</p>
        </div>
        <button className="primary-button" onClick={() => setEditing('new')}>
          <Plus size={18} /> Add a memory
        </button>
      </div>
      <div className="memory-info">
        <Brain size={21} />
        <p>
          Shared memories travel across settings. Other memories stay in the contexts you choose.
        </p>
      </div>
      <div className="filter-row">
        <div className="filter-tabs" aria-label="Filter memories">
          {(['all', 'shared', ...contexts] as const).map((c) => (
            <button
              key={c}
              aria-pressed={filter === c}
              className={filter === c ? 'active' : ''}
              onClick={() => setFilter(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <label className="search-field">
          <Search size={17} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a memory"
            aria-label="Find a memory"
          />
        </label>
      </div>
      <div className="memory-grid">
        {shown.map((memory) => (
          <article
            key={memory.id}
            className={`memory-card ${memory.status === 'pending' ? 'pending' : ''}`}
          >
            <div className="card-top">
              <span className="tag">{memory.category}</span>
              <div className="icon-actions">
                <button aria-label={`Edit ${memory.content}`} onClick={() => setEditing(memory)}>
                  <Pencil size={16} />
                </button>
                <button aria-label={`Delete ${memory.content}`} onClick={() => setDeleting(memory)}>
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            <p className="memory-content">{memory.content}</p>
            <div className="memory-scopes">
              {memory.contexts.length ? (
                memory.contexts.map((c) => <span key={c}>{c}</span>)
              ) : (
                <span>Shared across settings</span>
              )}
            </div>
            <div className="memory-footer">
              <span>
                {memory.source === 'manual'
                  ? 'Added by you'
                  : memory.source === 'onboarding'
                    ? 'From your introduction'
                    : 'Learned from your words'}
              </span>
              {memory.sensitivity === 'sensitive' && <span>Private</span>}
            </div>
            {memory.status === 'pending' && (
              <div className="pending-row">
                <p>
                  Review before using ·{' '}
                  {memory.sensitivity === 'sensitive' ? 'sensitive detail' : 'possible update'}
                </p>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api(`/memories/${memory.id}/approve`, {});
                      await refresh();
                    } catch (error) {
                      notify((error as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Check size={16} /> Use this memory
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      {!shown.length && (
        <div className="empty-panel">
          <Brain size={36} strokeWidth={1.4} />
          <h2>{search ? 'No matching memories' : 'A little about you goes a long way.'}</h2>
          <p>Add a personal detail or introduce yourself in Your profile.</p>
          <button className="text-button" onClick={() => setEditing('new')}>
            Add your first memory <ArrowUpRight size={16} />
          </button>
        </div>
      )}
      <dialog
        ref={dialog}
        onCancel={() => setEditing(null)}
        onClick={(e) => {
          if (e.target === dialog.current) setEditing(null);
        }}
        className="modal"
      >
        {editing && (
          <form onSubmit={save} key={typeof editing === 'string' ? editing : editing.id}>
            <div className="modal-header">
              <h2>{editing === 'new' ? 'Add a memory' : 'Edit memory'}</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Close memory editor"
                onClick={() => setEditing(null)}
              >
                <X size={20} />
              </button>
            </div>
            <label>
              What should phier know?
              <textarea
                name="content"
                required
                minLength={2}
                maxLength={300}
                autoFocus
                defaultValue={editing === 'new' ? '' : editing.content}
                placeholder="I enjoy golf and tennis."
              />
            </label>
            <label>
              Category
              <select
                name="category"
                defaultValue={editing === 'new' ? 'interest' : editing.category}
              >
                {['background', 'language', 'interest', 'work', 'preference', 'boundary'].map(
                  (c) => (
                    <option key={c}>{c}</option>
                  ),
                )}
              </select>
            </label>
            <fieldset>
              <legend>Use in these settings</legend>
              <p className="hint">Leave all unchecked to share across every setting.</p>
              <div className="checkbox-row">
                {contexts.map((c) => (
                  <label key={c}>
                    <input
                      name="contexts"
                      type="checkbox"
                      value={c}
                      defaultChecked={editing !== 'new' && editing.contexts.includes(c)}
                    />
                    {c}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="check-label">
              <input
                type="checkbox"
                name="sensitivity"
                defaultChecked={editing !== 'new' && editing.sensitivity === 'sensitive'}
              />{' '}
              This is a sensitive personal detail
            </label>
            <button className="primary-button full" disabled={busy}>
              {busy ? 'Saving…' : 'Save memory'}
            </button>
          </form>
        )}
      </dialog>
      <dialog ref={deleteDialog} onCancel={() => setDeleting(null)} className="modal small-modal">
        <h2>Forget this detail?</h2>
        <p>{deleting?.content}</p>
        <p className="hint">It will stop influencing your responses.</p>
        <div className="button-row">
          <button className="secondary-button" onClick={() => setDeleting(null)}>
            Keep it
          </button>
          <button
            className="danger-button"
            disabled={busy}
            onClick={async () => {
              if (!deleting) return;
              setBusy(true);
              try {
                await api(`/memories/${deleting.id}`, undefined, 'DELETE');
                await refresh();
                setDeleting(null);
                notify('Memory deleted.');
              } catch (error) {
                notify((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Forget memory
          </button>
        </div>
      </dialog>
    </section>
  );
}
