import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Response } from 'openai/resources/responses/responses';
import { Store } from '../server/store';
import { createApp } from '../server/app';
import { MockProvider } from '../server/providers/mock';
import { ProviderRuntime } from '../server/providers/runtime';
import {
  groundCards,
  retrievedSources,
  type KnowledgeProvider,
} from '../server/knowledge-provider';
import { transcriptionConfiguration } from '../server/providers/asr';
import {
  GroundedKnowledgeSchema,
  type KnowledgeEntry,
  type KnowledgeSource,
} from '../shared/knowledge';

const topics = [{ keyword: 'Cache', context: 'Discussing cache persistence.', deeper: true }];
const sources: KnowledgeSource[] = [
  { id: 0, title: 'Primary documentation', url: 'https://docs.example.org/cache' },
  { id: 1, title: 'Independent research', url: 'https://research.example.edu/paper' },
];
const raw = () => ({
  cards: [
    {
      keyword: 'Cache',
      explanation: 'A contextual explanation supported by the test evidence.',
      related: ['Eviction'],
      background: 'More detailed evidence.',
      sourceIds: [0],
      flag: {
        claim: 'Caches never evict data',
        explanation: 'The supplied evidence contradicts this claim.',
        level: '!!!',
        sourceIds: [0, 1],
      },
    },
  ],
  questions: ['What affects eviction?', 'How could workloads change this?', 'What can we measure?'],
});
const entry = (): KnowledgeEntry => ({
  id: randomUUID(),
  sessionId: randomUUID(),
  text: 'Caches never evict data',
  createdAt: new Date().toISOString(),
  ...groundCards(raw(), sources, 'Caches never evict data', topics),
});
const stores: Store[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  stores.splice(0).forEach((store) => store.close());
});

describe('knowledge evidence boundary', () => {
  it('accepts only HTTP citations actually attached to retrieved evidence', () => {
    const output = [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            annotations: [
              { type: 'url_citation', url: 'https://docs.example.org/cache', title: 'Docs' },
              { type: 'url_citation', url: 'https://docs.example.org/cache', title: 'Duplicate' },
              { type: 'url_citation', url: 'javascript:alert(1)', title: 'Unsafe' },
              { type: 'url_citation', url: 'https://user:secret@example.org', title: 'Unsafe' },
            ],
          },
        ],
      },
    ] as Response['output'];
    expect(retrievedSources({ output })).toEqual([
      { id: 0, url: 'https://docs.example.org/cache', title: 'Docs' },
    ]);
  });
  it('requires exactly three sparking questions', () => {
    expect(GroundedKnowledgeSchema.safeParse({ ...raw(), questions: ['Just one?'] }).success).toBe(
      false,
    );
  });
  it('never displays invented citation IDs or uncited explanations', () => {
    const result = raw();
    result.cards[0].sourceIds = [999];
    expect(() => groundCards(result, sources, 'Caches never evict data', topics)).toThrow(
      'usable citations',
    );
  });
  it('only flags a claim actually spoken and requires corroboration for !!!', () => {
    expect(groundCards(raw(), sources, 'What is a cache?', topics).cards[0].flag).toBeNull();
    const result = raw();
    result.cards[0].flag.sourceIds = [0, 0, 999];
    expect(
      groundCards(result, sources, 'Caches never evict data', topics).cards[0].flag?.level,
    ).toBe('!!');
    expect(
      groundCards(raw(), sources, 'Caches never evict data', topics).cards[0].flag?.level,
    ).toBe('!!!');
    result.cards[0].flag.sourceIds = [999];
    expect(
      groundCards(result, sources, 'Caches never evict data', topics).cards[0].flag,
    ).toBeNull();
  });
  it('adds deeper background only when speech is digging deeper', () => {
    expect(
      groundCards(raw(), sources, 'Caches never evict data', [{ ...topics[0], deeper: false }])
        .cards[0].background,
    ).toBeNull();
  });
  it('transcribes knowledge in English while preserving Japanese defaults', () => {
    expect(transcriptionConfiguration('whisper-1', 'en').session.audio.input.transcription).toEqual(
      { model: 'whisper-1', language: 'en' },
    );
    expect(
      transcriptionConfiguration('gpt-live-transcribe', 'en').session.audio.input.transcription,
    ).toMatchObject({ languages: ['en'] });
    expect(transcriptionConfiguration('whisper-1').session.audio.input.transcription).toMatchObject(
      { language: 'ja' },
    );
  });
});

describe('browser library persistence', () => {
  it('survives restart, isolates owners, and prevents cross-owner deletion', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phier-knowledge-'));
    try {
      let store = new Store(join(dir, 'test.sqlite'));
      const item = entry();
      store.saveKnowledge('alice', item);
      store.close();
      store = new Store(join(dir, 'test.sqlite'));
      expect(store.knowledge('alice')).toEqual([item]);
      expect(store.knowledge('bob')).toEqual([]);
      store.deleteKnowledge('bob', item.id);
      expect(store.knowledgeEntry('alice', item.id)).toEqual(item);
      store.saveKnowledge('alice', { ...item, text: 'duplicate should not overwrite' });
      expect(store.knowledge('alice')).toHaveLength(1);
      expect(store.knowledgeEntry('alice', item.id)?.text).toBe(item.text);
      store.deleteKnowledge('alice', item.id);
      expect(store.knowledge('alice')).toEqual([]);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

async function setup(providerOverrides: Partial<KnowledgeProvider> = {}) {
  const store = new Store(':memory:');
  stores.push(store);
  const provider: KnowledgeProvider = {
    status: () => ({ configured: true, message: 'Test provider' }),
    detect: vi.fn(async () => topics),
    research: vi.fn(async () => groundCards(raw(), sources, 'Caches never evict data', topics)),
    ...providerOverrides,
  };
  const server = createServer();
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as AddressInfo).port;
  const runtime = new ProviderRuntime(() => ({
    mode: 'mock',
    demoEnabled: true,
    textModel: '',
    memoryModel: '',
    speechModel: '',
    trtcConfigured: false,
  }));
  const { app } = createApp(store, new MockProvider(), {
    runtime,
    port,
    trtc: null,
    knowledge: provider,
  });
  server.on('request', app);
  const base = `http://127.0.0.1:${port}/api/knowledge`;
  const status = await fetch(`${base}/status`);
  const cookie = status.headers.get('set-cookie')!.split(';')[0];
  const headers = { 'Content-Type': 'application/json', 'X-Phier-Client': '1', Cookie: cookie };
  return { provider, base, headers, status };
}
describe('knowledge HTTP flow', () => {
  it('streams keywords before completion, saves scoped results and deduplicates retries', async () => {
    const { provider, base, headers, status } = await setup();
    expect(status.headers.get('set-cookie')).toContain('HttpOnly');
    expect(status.headers.get('set-cookie')).toContain('SameSite=Strict');
    const input = { id: randomUUID(), sessionId: randomUUID(), text: 'Caches never evict data' };
    const run = () =>
      fetch(`${base}/analyze`, { method: 'POST', headers, body: JSON.stringify(input) });
    const response = await run();
    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events.map((event) => event.type)).toEqual(['keywords', 'complete']);
    expect(events[1].entry.questions).toHaveLength(3);
    await (await run()).text();
    expect(provider.research).toHaveBeenCalledTimes(1);
    const own = await (await fetch(`${base}/library`, { headers })).json();
    expect(own.entries).toHaveLength(1);
    const other = await (await fetch(`${base}/library`)).json();
    expect(other.entries).toEqual([]);
    await fetch(`${base}/library/${input.id}`, {
      method: 'DELETE',
      headers: { 'X-Phier-Client': '1' },
    });
    expect((await (await fetch(`${base}/library`, { headers })).json()).entries).toHaveLength(1);
    await fetch(`${base}/library/${input.id}`, { method: 'DELETE', headers });
    expect((await (await fetch(`${base}/library`, { headers })).json()).entries).toEqual([]);
  });
  it('leaves failed research unsaved and permits retry', async () => {
    const research = vi
      .fn()
      .mockRejectedValueOnce(new Error('upstream credential secret'))
      .mockResolvedValueOnce(groundCards(raw(), sources, 'Caches never evict data', topics));
    const { base, headers } = await setup({ research });
    const body = JSON.stringify({
      id: randomUUID(),
      sessionId: randomUUID(),
      text: 'Caches never evict data',
    });
    const result = await (await fetch(`${base}/analyze`, { method: 'POST', headers, body })).text();
    expect(result).toContain('"type":"error"');
    expect(result).not.toContain('credential secret');
    expect((await (await fetch(`${base}/library`, { headers })).json()).entries).toEqual([]);
    expect(
      await (await fetch(`${base}/analyze`, { method: 'POST', headers, body })).text(),
    ).toContain('"type":"complete"');
  });
  it('does not research filler, and rejects invalid input and missing client headers', async () => {
    const { provider, base, headers } = await setup({ detect: async () => [] });
    const body = JSON.stringify({ id: randomUUID(), sessionId: randomUUID(), text: 'Hello' });
    await (await fetch(`${base}/analyze`, { method: 'POST', headers, body })).text();
    expect(provider.research).not.toHaveBeenCalled();
    expect((await (await fetch(`${base}/library`, { headers })).json()).entries).toEqual([]);
    expect((await fetch(`${base}/analyze`, { method: 'POST', headers, body: '{}' })).status).toBe(
      400,
    );
    expect((await fetch(`${base}/analyze`, { method: 'POST', body })).status).toBe(403);
  });
});
