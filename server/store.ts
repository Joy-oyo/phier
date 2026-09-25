import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import {
  defaultSettings,
  SettingsSchema,
  type Context,
  type Memory,
  type MemoryInput,
  type Settings,
} from '../shared/types';

// Keep only a one-way fingerprint after forgetting, not the deleted fact itself.
const normalized = (text: string) =>
  createHash('sha256')
    .update(
      text
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\s\p{P}]+/gu, ''),
    )
    .digest('hex');
export class Store {
  private db: DatabaseSync;
  // Sensitive inferred facts stay in RAM until the user explicitly approves them.
  private pendingSensitive = new Map<string, Memory>();
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, body TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS forgotten (fingerprint TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS metrics (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, body TEXT NOT NULL);`);
    this.db
      .prepare('INSERT OR IGNORE INTO settings VALUES(1, ?)')
      .run(JSON.stringify(defaultSettings));
  }
  settings(): Settings {
    return SettingsSchema.parse(
      JSON.parse(
        (this.db.prepare('SELECT body FROM settings WHERE id=1').get() as { body: string }).body,
      ),
    );
  }
  saveSettings(input: Settings) {
    const settings = SettingsSchema.parse(input);
    this.db.prepare('UPDATE settings SET body=? WHERE id=1').run(JSON.stringify(settings));
    return settings;
  }
  memories(): Memory[] {
    return [
      ...this.pendingSensitive.values(),
      ...(
        this.db.prepare('SELECT body FROM memories ORDER BY rowid DESC').all() as { body: string }[]
      ).map((row) => JSON.parse(row.body) as Memory),
    ];
  }
  add(input: MemoryInput, source: Memory['source'], approved = false): Memory | null {
    const fingerprint = normalized(input.content);
    if (
      source !== 'manual' &&
      !approved &&
      this.db.prepare('SELECT 1 FROM forgotten WHERE fingerprint=?').get(fingerprint)
    )
      return null;
    const existing = this.memories().find((m) => normalized(m.content) === fingerprint);
    if (existing)
      return approved && existing.status === 'pending' ? this.approve(existing.id) : existing;
    const conflict = this.memories().some((m) => m.key === input.key && m.status === 'active');
    const now = new Date().toISOString();
    const memory: Memory = {
      ...input,
      id: randomUUID(),
      source,
      status:
        approved || source === 'manual'
          ? 'active'
          : input.sensitivity === 'sensitive' || conflict || input.confidence < 0.85
            ? 'pending'
            : 'active',
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
    };
    if (input.sensitivity === 'sensitive' && !approved && source !== 'manual') {
      this.pendingSensitive.set(memory.id, memory);
      return memory;
    }
    this.db
      .prepare('INSERT INTO memories VALUES(?,?,?)')
      .run(memory.id, JSON.stringify(memory), fingerprint);
    return memory;
  }
  update(id: string, input: MemoryInput): Memory {
    const previous = this.memories().find((m) => m.id === id);
    if (!previous) throw new Error('Memory not found.');
    const fingerprint = normalized(input.content);
    if (this.memories().some((m) => m.id !== id && normalized(m.content) === fingerprint))
      throw new Error('That memory already exists.');
    const next: Memory = {
      ...previous,
      ...input,
      source: 'manual',
      status: 'active',
      updatedAt: new Date().toISOString(),
    };
    this.db.prepare('INSERT OR IGNORE INTO forgotten VALUES(?)').run(normalized(previous.content));
    this.db
      .prepare('INSERT OR REPLACE INTO memories VALUES(?,?,?)')
      .run(id, JSON.stringify(next), fingerprint);
    this.pendingSensitive.delete(id);
    return next;
  }
  approve(id: string): Memory {
    const memory = this.memories().find((m) => m.id === id);
    if (!memory) throw new Error('Memory not found.');
    for (const other of this.memories().filter((m) => m.id !== id && m.key === memory.key))
      this.remove(other.id);
    return this.update(id, memory);
  }
  remove(id: string) {
    const memory = this.memories().find((m) => m.id === id);
    if (memory)
      this.db.prepare('INSERT OR IGNORE INTO forgotten VALUES(?)').run(normalized(memory.content));
    this.db.prepare('DELETE FROM memories WHERE id=?').run(id);
    this.pendingSensitive.delete(id);
  }
  markUsed(ids: string[]) {
    for (const memory of this.memories().filter((m) => ids.includes(m.id))) {
      memory.lastUsedAt = new Date().toISOString();
      this.db
        .prepare('UPDATE memories SET body=? WHERE id=?')
        .run(JSON.stringify(memory), memory.id);
    }
  }
  recordMetric(id: string, metrics: object) {
    this.db
      .prepare('INSERT OR REPLACE INTO metrics VALUES(?,?,?)')
      .run(id, new Date().toISOString(), JSON.stringify(metrics));
    this.db.exec(
      'DELETE FROM metrics WHERE id NOT IN (SELECT id FROM metrics ORDER BY created_at DESC LIMIT 100)',
    );
  }
  metrics() {
    return (
      this.db.prepare('SELECT body FROM metrics ORDER BY created_at DESC LIMIT 30').all() as {
        body: string;
      }[]
    ).map((row) => JSON.parse(row.body));
  }
  close() {
    this.pendingSensitive.clear();
    this.db.close();
  }
}

export function retrieveMemories(all: Memory[], context: Context, text: string): Memory[] {
  const question = text.toLowerCase();
  const interest = /趣味|週末|休み|好き|ゴルフ|テニス|hobb|weekend|like|interest/.test(question);
  const background = /出身|国|育ち|from|background|nationality/.test(question);
  const work = /仕事|会社|職業|work|job|career|business/.test(question);
  return all
    .filter((m) => m.status === 'active' && (!m.contexts.length || m.contexts.includes(context)))
    .map((m) => ({
      memory: m,
      score:
        (m.category === 'boundary' || m.category === 'preference' ? 3 : 0) +
        (m.category === 'interest' && interest ? 5 : 0) +
        (m.category === 'background' && background ? 5 : 0) +
        (m.category === 'work' && work ? 5 : 0) +
        (m.category === 'language' ? 1 : 0),
    }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((m) => m.memory);
}
