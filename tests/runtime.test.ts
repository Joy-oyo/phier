import { describe, expect, it, vi } from 'vitest';
import { ProviderRuntime, type RuntimeConfig } from '../server/providers/runtime';
import { safeProviderError } from '../server/providers/errors';
import { MockProvider } from '../server/providers/mock';
import { ConversationService } from '../server/service';
import { Store } from '../server/store';
import { defaultSettings } from '../shared/types';
const base: RuntimeConfig = {
  mode: 'openai',
  demoEnabled: false,
  textModel: 'text',
  memoryModel: 'memory',
  speechModel: 'speech',
  trtcConfigured: false,
};
describe('real-provider readiness', () => {
  it('never substitutes fixtures when a key is missing', async () => {
    const runtime = new ProviderRuntime(() => base);
    expect(runtime.mode).toBe('openai');
    expect(runtime.liveAvailable).toBe(false);
    await expect(runtime.translate('週末は何をしていますか？', 'en')).rejects.toThrow('API key');
    await expect(runtime.extract('I enjoy tennis.', defaultSettings)).rejects.toThrow('API key');
    expect((await runtime.check()).configured).toBe(false);
  });
  it('reports readiness for TRTC sessions without the OpenAI speech probe', () => {
    const runtime = new ProviderRuntime(() => ({ ...base, trtcConfigured: true }));
    expect(runtime.liveAvailable).toBe(true);
  });
  it('reloads credentials and requires all real component probes before reporting readiness', async () => {
    let config = base;
    const close = vi.fn();
    const language = {
      translate: vi.fn().mockResolvedValue('Hello.'),
      generate: vi.fn().mockResolvedValue({}),
      extract: vi.fn().mockResolvedValue([]),
      pronounce: vi.fn(),
    };
    const factory = vi.fn(() => ({
      language,
      speech: {
        connect(callback: any) {
          queueMicrotask(() => callback({ type: 'ready' }));
          return { close, append() {}, clear() {}, commit() {} };
        },
      },
    }));
    const runtime = new ProviderRuntime(() => config, factory);
    config = { ...base, key: 'test-only-secret' };
    const result = await runtime.check();
    expect(result.text.status).toBe('ready');
    expect(result.memory.status).toBe('ready');
    expect(result.speech.status).toBe('ready');
    expect(runtime.liveAvailable).toBe(true);
    expect(close).toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('test-only-secret');
    expect(language.generate).toHaveBeenCalledTimes(1);
    expect(language.extract).toHaveBeenCalledTimes(1);
  });
  it('shows actionable billing errors and does not mark a failing provider ready', async () => {
    const language = {
      translate: vi
        .fn()
        .mockRejectedValue({ status: 429, code: 'insufficient_quota', message: 'SECRET_KEY' }),
      generate: vi.fn(),
      extract: vi.fn().mockResolvedValue([]),
      pronounce: vi.fn(),
    };
    const runtime = new ProviderRuntime(
      () => ({ ...base, key: 'private' }),
      () => ({
        language,
        speech: {
          connect(cb) {
            queueMicrotask(() => cb({ type: 'ready' }));
            return { close() {}, append() {}, clear() {}, commit() {} };
          },
        },
      }),
    );
    const result = await runtime.check();
    expect(runtime.liveAvailable).toBe(false);
    expect(result.text.message).toContain('billing');
    expect(JSON.stringify(result)).not.toContain('SECRET_KEY');
  });
  it('rejects forged demo flags in the service by default', () => {
    const store = new Store(':memory:');
    const service = new ConversationService(store, new MockProvider());
    expect(() =>
      service.process({
        id: crypto.randomUUID(),
        text: 'anything',
        speaker: 'partner',
        demo: true,
        recent: [],
      }),
    ).toThrow('disabled');
    service.clear();
    store.close();
  });
  it('redacts provider error content', () => {
    const error = safeProviderError({ status: 401, message: 'invalid key sk-secret' });
    expect(error.code).toBe('invalid_key');
    expect(error.message).not.toContain('sk-secret');
  });
  it('identifies exhausted credits for text and speech errors', () => {
    const error = safeProviderError({
      code: 'credit_balance_exhausted',
      type: 'insufficient_quota',
    });
    expect(error.code).toBe('credit_balance_exhausted');
    expect(error.message).toContain('credits are exhausted');
  });
});
