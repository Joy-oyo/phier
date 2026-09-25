import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Store, retrieveMemories } from '../server/store';
import { MockProvider } from '../server/providers/mock';
import { ConversationService } from '../server/service';
import { defaultSettings, type MemoryInput } from '../shared/types';
import { validateReply, kanaPattern } from '../shared/validation';
import { VoiceDetector } from '../src/lib/vad';
import { transcriptionConfiguration } from '../server/providers/asr';

const stores: Store[] = [];
const services: ConversationService[] = [];
const memory = (extra: Partial<MemoryInput> = {}): MemoryInput => ({
  key: 'interest.tennis',
  content: 'I enjoy tennis.',
  category: 'interest',
  contexts: [],
  confidence: 0.96,
  sensitivity: 'normal',
  ...extra,
});
const makeStore = () => {
  const store = new Store(':memory:');
  stores.push(store);
  return store;
};
afterEach(async () => {
  for (const service of services.splice(0)) {
    await service.drain();
    service.clear();
  }
  stores.splice(0).forEach((s) => s.close());
});

describe('personal memory', () => {
  it('deduplicates facts and preserves a user correction', () => {
    const store = makeStore();
    const first = store.add(memory(), 'conversation')!;
    expect(store.add(memory(), 'conversation')!.id).toBe(first.id);
    store.update(first.id, memory({ content: 'I no longer enjoy tennis.' }));
    expect(store.add(memory(), 'conversation')).toBeNull();
    expect(store.memories()).toHaveLength(1);
  });
  it('keeps sensitive facts and conflicting updates out of retrieval until approval', () => {
    const store = makeStore();
    const original = store.add(memory(), 'manual')!;
    const update = store.add(memory({ content: 'I dislike tennis.' }), 'conversation')!;
    const sensitive = store.add(
      memory({ key: 'health', content: 'I have a medical condition.', sensitivity: 'sensitive' }),
      'conversation',
    )!;
    expect(update.status).toBe('pending');
    expect(sensitive.status).toBe('pending');
    expect(
      retrieveMemories(store.memories(), 'social', 'What do you like?').map((m) => m.id),
    ).toEqual([original.id]);
    store.approve(update.id);
    expect(store.memories().find((m) => m.id === original.id)).toBeUndefined();
    expect(store.memories().find((m) => m.id === update.id)?.status).toBe('active');
  });
  it('does not recreate deleted facts from background learning', () => {
    const store = makeStore();
    const entry = store.add(memory(), 'conversation')!;
    store.remove(entry.id);
    expect(store.add(memory(), 'conversation')).toBeNull();
    expect(store.add(memory(), 'manual')?.status).toBe('active');
  });
  it('allows explicitly approved onboarding to restore a forgotten detail', () => {
    const store = makeStore();
    const entry = store.add(memory(), 'manual')!;
    store.remove(entry.id);
    expect(store.add(memory(), 'onboarding', true)?.status).toBe('active');
  });
  it('keeps inferred sensitive details ephemeral until explicitly approved', () => {
    const store = makeStore();
    const sensitive = store.add(
      memory({
        key: 'health.condition',
        content: 'I have a medical condition.',
        sensitivity: 'sensitive',
      }),
      'conversation',
    )!;
    expect(sensitive.status).toBe('pending');
    // Inspect the storage boundary: ephemeral candidates must not enter SQLite.
    const db = (store as unknown as { db: { prepare(sql: string): { get(): { count: number } } } })
      .db;
    expect(db.prepare('SELECT COUNT(*) AS count FROM memories').get().count).toBe(0);
    store.approve(sensitive.id);
    expect(db.prepare('SELECT COUNT(*) AS count FROM memories').get().count).toBe(1);
    expect(store.memories()[0].status).toBe('active');
  });
  it('shares common interests but excludes memories from unrelated settings', () => {
    const store = makeStore();
    store.add(memory(), 'manual');
    store.add(
      memory({
        key: 'work.role',
        content: 'I work as a designer.',
        category: 'work',
        contexts: ['professional'],
      }),
      'manual',
    );
    store.add(
      memory({
        key: 'dating.boundary',
        content: 'Avoid personal questions.',
        category: 'boundary',
        contexts: ['dating'],
      }),
      'manual',
    );
    expect(retrieveMemories(store.memories(), 'social', 'What do you like?')).toHaveLength(1);
    expect(
      retrieveMemories(store.memories(), 'professional', 'What is your job?').map((m) => m.key),
    ).toEqual(['work.role']);
  });
});

describe('reply and attribution', () => {
  it('produces one kana reply informed by memory and no kanji', async () => {
    const store = makeStore();
    store.add(memory(), 'manual');
    const service = new ConversationService(store, new MockProvider());
    services.push(service);
    const response = await service.process({
      id: randomUUID(),
      text: '週末は何をしていますか？',
      speaker: 'partner',
      recent: [],
      demo: false,
    });
    expect(response.reply?.meaning).toBe('I like tennis.');
    expect(kanaPattern.test(response.reply!.pronunciation)).toBe(true);
    expect(response.reply?.memoryIdsUsed).toHaveLength(1);
  });
  it('does not assume origin from nationality, or invent an interest', async () => {
    const store = makeStore();
    store.add(
      memory({ key: 'background.nationality', content: 'I am Chinese.', category: 'background' }),
      'manual',
    );
    const service = new ConversationService(store, new MockProvider());
    services.push(service);
    const response = await service.process({
      id: randomUUID(),
      text: 'ご出身はどちらですか？',
      speaker: 'partner',
      recent: [],
      demo: false,
    });
    expect(response.reply?.memoryIdsUsed).toEqual([]);
    expect(response.reply?.meaning).toBe('How about you?');
  });
  it('deduplicates repeated turn IDs', async () => {
    const provider = new MockProvider();
    const generate = vi.spyOn(provider, 'generate');
    const service = new ConversationService(makeStore(), provider);
    services.push(service);
    const input = {
      id: randomUUID(),
      text: '週末は何をしていますか？',
      speaker: 'partner' as const,
      recent: [],
      demo: false,
    };
    const result = await Promise.all([service.process(input), service.process(input)]);
    expect(result[0]).toEqual(result[1]);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('learns only from user statements, never partner text or a generated suggestion', async () => {
    const store = makeStore();
    const provider = new MockProvider();
    const extraction = vi.spyOn(provider, 'extract');
    const service = new ConversationService(store, provider);
    services.push(service);
    await service.process({
      id: randomUUID(),
      text: '週末は何をしていますか？',
      speaker: 'partner',
      recent: [],
      demo: false,
    });
    await service.drain();
    expect(extraction).not.toHaveBeenCalled();
    expect(store.memories()).toHaveLength(0);
    await service.process({
      id: randomUUID(),
      text: 'I enjoy tennis.',
      speaker: 'user',
      recent: [],
      demo: false,
    });
    await service.drain();
    expect(store.memories()[0].content).toBe('I enjoy tennis.');
  });
  it('respects disabled automatic learning', async () => {
    const store = makeStore();
    store.saveSettings({ ...defaultSettings, autoLearn: false });
    const service = new ConversationService(store, new MockProvider());
    services.push(service);
    await service.process({
      id: randomUUID(),
      text: 'I enjoy tennis.',
      speaker: 'user',
      recent: [],
      demo: false,
    });
    await service.drain();
    expect(store.memories()).toHaveLength(0);
  });
  it('recognizes explicitly spoken languages without inferring from background', async () => {
    const provider = new MockProvider();
    const result = await provider.extract(
      'I am Chinese. I speak English and Cantonese. I enjoy golf and tennis.',
      defaultSettings,
    );
    expect(result.map((m) => m.key)).toEqual([
      'background.nationality',
      'language.english',
      'language.cantonese',
      'interest.golf',
      'interest.tennis',
    ]);
    expect(result.find((m) => m.content.includes('Mandarin'))).toBeUndefined();
    expect(
      await provider.extract('My friend loves tennis. I do not play golf.', defaultSettings),
    ).toEqual([]);
  });
  it('validates reply length, pronunciation and memory references', () => {
    const base = {
      responseText: 'テニスが好きです。',
      pronunciation: 'テニスが すきです。',
      meaning: 'I like tennis.',
      memoryIdsUsed: [],
    };
    expect(() => validateReply(base, 'kana', [])).not.toThrow();
    expect(() =>
      validateReply({ ...base, pronunciation: 'テニスが好きです。' }, 'kana', []),
    ).toThrow();
    expect(() =>
      validateReply({ ...base, responseText: 'はい。そうです。わかりました。' }, 'kana', []),
    ).toThrow();
    expect(() => validateReply({ ...base, memoryIdsUsed: ['invented'] }, 'kana', [])).toThrow();
    expect(() => validateReply(base, 'ipa', [])).toThrow();
  });
});

describe('local audio turn detection', () => {
  it('does not trigger on background silence or brief noise', () => {
    const vad = new VoiceDetector(800);
    for (let i = 0; i < 100; i++) expect(vad.consume(0.003, 20)).toBeNull();
    expect(vad.consume(0.08, 20)).toBeNull();
    expect(vad.consume(0.001, 20)).toBeNull();
    expect(vad.speaking).toBe(false);
  });
  it('ends once after silence and resets for the next utterance', () => {
    const vad = new VoiceDetector(800);
    for (let i = 0; i < 4; i++) expect(vad.consume(0.07, 20)).toBeNull();
    expect(vad.consume(0.07, 20)).toBe('start');
    for (let i = 0; i < 39; i++) expect(vad.consume(0.001, 20)).toBeNull();
    expect(vad.consume(0.001, 20)).toBe('end');
    expect(vad.consume(0.001, 20)).toBeNull();
    expect(vad.speaking).toBe(false);
  });
  it('uses local commits for the live transcription model', () => {
    const config = transcriptionConfiguration('gpt-live-transcribe');
    expect(config.session.audio.input.turn_detection).toBeNull();
    expect(config.session.audio.input.transcription).toEqual({
      model: 'gpt-live-transcribe',
      languages: ['ja', 'en'],
      delay: 'low',
    });
  });
});
