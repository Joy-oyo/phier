import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ConversationService } from '../server/service';
import { Store } from '../server/store';
import { MockProvider } from '../server/providers/mock';
import { validateReply } from '../shared/validation';
import { TurnSchema } from '../shared/types';

const stores: Store[] = [],
  services: ConversationService[] = [];
function setup() {
  const store = new Store(':memory:');
  stores.push(store);
  const provider = new MockProvider();
  const service = new ConversationService(store, provider);
  services.push(service);
  return { store, provider, service };
}
afterEach(async () => {
  for (const service of services.splice(0)) {
    await service.drain();
    service.clear();
  }
  for (const store of stores.splice(0)) store.close();
});
const input = () =>
  TurnSchema.parse({
    id: randomUUID(),
    text: '週末は何をしていますか？',
    speaker: 'partner',
    translated: { text: 'What do you do on weekends?', language: 'en' },
  });
describe('finalized questions to replies', () => {
  it('reuses a finalized translation instead of charging for another translation', async () => {
    const { provider, service } = setup();
    const translate = vi.spyOn(provider, 'translate');
    const generate = vi.spyOn(provider, 'generate');
    const result = await service.process(input());
    expect(translate).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.translation).toBe('What do you do on weekends?');
    expect(result.reply?.pronunciationMode).toBe('kana');
  });
  it('does not reuse subtitles in the wrong explanation language', async () => {
    const { provider, service } = setup();
    const translate = vi.spyOn(provider, 'translate');
    await service.process({ ...input(), translated: { text: '周末做什么？', language: 'zh' } });
    expect(translate).toHaveBeenCalledTimes(1);
  });
  it('rejects kanji even if a provider returns an otherwise valid reply', async () => {
    const { provider, service } = setup();
    vi.spyOn(provider, 'generate').mockResolvedValue({
      responseText: 'テニスがすきです。',
      pronunciation: 'テニスが好きです。',
      meaning: 'I like tennis.',
      memoryIdsUsed: [],
      targetLanguage: 'ja',
      pronunciationMode: 'kana',
    });
    await expect(service.process(input())).rejects.toThrow('kana only');
  });
  it('does not accept replies for a cancelled turn', async () => {
    const { provider, service } = setup();
    const controller = new AbortController();
    const original = provider.generate.bind(provider);
    vi.spyOn(provider, 'generate').mockImplementation(async (value) => {
      const reply = await original(value);
      controller.abort();
      return reply;
    });
    await expect(service.process(input(), controller.signal)).rejects.toThrow();
  });
  it('rejects punctuation-only or more than two spoken sentences', () => {
    const reply = {
      responseText: 'はい。',
      pronunciation: '。',
      meaning: 'Yes.',
      memoryIdsUsed: [],
    };
    expect(() => validateReply(reply, 'kana', [])).toThrow('kana only');
    expect(() =>
      validateReply({ ...reply, pronunciation: 'はい。そうです。ありがとう。' }, 'kana', []),
    ).toThrow('at most two');
  });
});
