import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LocalAsrProvider, LocalModel, loopbackUrl, pcmToWave } from '../server/providers/local';
import { publicReferences } from '../server/local-knowledge';
import { ProviderRuntime } from '../server/providers/runtime';

afterEach(() => vi.unstubAllGlobals());
describe('local provider', () => {
  it('does not allow a local endpoint to send speech to a remote host', () => {
    expect(loopbackUrl('http://127.0.0.1:8081')).toBe('http://127.0.0.1:8081');
    expect(() => loopbackUrl('https://example.org')).toThrow('localhost');
    expect(() => loopbackUrl('http://localhost.evil.test')).toThrow('localhost');
    expect(() => loopbackUrl('http://secret@localhost')).toThrow('localhost');
  });
  it('uses Ollama schema-constrained local output without any API key', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ message: { content: '{"answer":"hello"}' }, done_reason: 'stop' }),
        ),
      );
    vi.stubGlobal('fetch', fetcher);
    expect(
      await new LocalModel().structured(z.object({ answer: z.string() }), 'Reply', { text: 'Hi' }),
    ).toEqual({ answer: 'hello' });
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    expect(options.headers.Authorization).toBeUndefined();
    expect(JSON.parse(options.body).format.type).toBe('object');
  });
  it('enables local readiness checks without cloud credentials', async () => {
    const language = {
      translate: vi.fn(async () => 'Hello'),
      generate: vi.fn(async () => ({}) as any),
      pronounce: vi.fn(),
      extract: vi.fn(async () => []),
    };
    const runtime = new ProviderRuntime(
      () => ({
        mode: 'local',
        demoEnabled: false,
        textModel: 'qwen',
        memoryModel: '',
        speechModel: 'Whisper',
        trtcConfigured: false,
      }),
      () => ({
        language,
        speech: {
          connect(callback) {
            queueMicrotask(() => callback({ type: 'ready' }));
            return { append() {}, commit() {}, clear() {}, close() {} };
          },
        },
      }),
    );
    expect(runtime.mode).toBe('local');
    expect(runtime.configurationError).toBeNull();
    expect((await runtime.check()).configured).toBe(true);
    expect(runtime.liveAvailable).toBe(true);
  });
  it('resamples 24 kHz PCM into a correct mono 16 kHz WAV', () => {
    const pcm = Buffer.alloc(48_000);
    for (let i = 0; i < 24_000; i++) pcm.writeInt16LE(1234, i * 2);
    const wav = pcmToWave(pcm);
    expect(wav.length).toBe(32_044);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readInt16LE(44)).toBe(1234);
    expect(wav.readInt16LE(wav.length - 2)).toBe(1234);
  });
  it('buffers audio locally, recognizes after commit and releases the session', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(''))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: ' A content delivery network. ' })),
      );
    vi.stubGlobal('fetch', fetcher);
    const events: any[] = [];
    const session = new LocalAsrProvider().connect((event) => events.push(event));
    await vi.waitFor(() => expect(events[0]?.type).toBe('ready'));
    session.append(Buffer.alloc(4800));
    session.commit();
    await vi.waitFor(() => expect(events[1]?.text).toBe('A content delivery network.'));
    expect(fetcher.mock.calls[1][0]).toBe('http://127.0.0.1:8081/inference');
    expect(fetcher.mock.calls[1][1].body.get('language')).toBe('en');
    session.close();
  });
  it('only returns public references with actual excerpts, not invented academic titles', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: URL) =>
          new Response(
            JSON.stringify(
              url.hostname === 'en.wikipedia.org'
                ? {
                    query: {
                      pages: {
                        1: {
                          title: 'Cache',
                          fullurl: 'https://en.wikipedia.org/wiki/Cache',
                          extract: 'A source excerpt. '.repeat(20),
                        },
                      },
                    },
                  }
                : {
                    message: {
                      items: [
                        { title: ['No abstract'], DOI: '10.1/none' },
                        {
                          title: ['A paper'],
                          DOI: '10.1/paper',
                          abstract: '<p>Actual abstract.</p>',
                        },
                      ],
                    },
                  },
            ),
          ),
      ),
    );
    const references = await publicReferences(
      [{ keyword: 'Cache', context: 'Computing', deeper: false }],
      new AbortController().signal,
    );
    expect(references).toHaveLength(2);
    expect(references[1].excerpt).toBe('Actual abstract.');
    expect(references.map((source) => source.id)).toEqual([0, 1]);
  });
});
