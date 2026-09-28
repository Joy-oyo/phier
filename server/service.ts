import { MockProvider } from './providers/mock';
import type { LanguageProvider } from './providers/types';
import { retrieveMemories, Store } from './store';
import type { TurnInput, TurnResult } from '../shared/types';
import { ProviderError } from './providers/errors';
import { validateReply } from '../shared/validation';

export class ConversationService {
  private turns = new Map<
    string,
    { promise: Promise<TurnResult>; timer: ReturnType<typeof setTimeout> }
  >();
  private jobs = new Set<Promise<unknown>>();
  constructor(
    private store: Store,
    private provider: LanguageProvider,
    private demosAllowed: () => boolean = () => false,
  ) {}
  process(input: TurnInput, signal?: AbortSignal): Promise<TurnResult> {
    if (input.demo && !this.demosAllowed())
      throw new ProviderError('Sample data is disabled.', 403, 'demo_disabled');
    const previous = this.turns.get(input.id);
    if (previous) return previous.promise;
    if (this.turns.size >= 30) throw new Error('Too many recent turns. Please wait a moment.');
    const promise = this.run(input, signal);
    const timer = setTimeout(() => this.turns.delete(input.id), 30_000);
    timer.unref();
    this.turns.set(input.id, { promise, timer });
    // Failed requests can be retried with the same ID.
    void promise.catch(() => {
      clearTimeout(timer);
      this.turns.delete(input.id);
    });
    return promise;
  }
  private async run(input: TurnInput, signal?: AbortSignal): Promise<TurnResult> {
    const started = performance.now();
    const settings = this.store.settings();
    const provider = input.demo ? new MockProvider() : this.provider;
    const translation =
      input.translated?.language === settings.explanationLanguage
        ? input.translated.text
        : await provider.translate(input.text, settings.explanationLanguage, signal);
    const translated = performance.now();
    let reply = null;
    if (input.speaker === 'partner') {
      const memories = retrieveMemories(
        this.store.memories(),
        settings.context,
        `${input.text} ${translation}`,
      );
      const generated = await provider.generate(
        { text: input.text, translation, settings, memories, recent: input.recent },
        signal,
      );
      signal?.throwIfAborted();
      reply = validateReply(
        generated,
        settings.pronunciationMode,
        memories.map((memory) => memory.id),
      );
      this.store.markUsed(reply.memoryIdsUsed);
    }
    const finished = performance.now();
    signal?.throwIfAborted();
    const metrics = {
      translationMs: Math.round(translated - started),
      generationMs: Math.round(finished - translated),
      totalMs: Math.round(finished - started),
    };
    this.store.recordMetric(input.id, { ...metrics, demo: input.demo, context: settings.context });
    // Never learn from partner audio or from generated suggestions.
    if (input.speaker === 'user' && settings.autoLearn) {
      const job = new Promise<void>((resolve) => setImmediate(resolve))
        .then(async () => {
          const extracted = await provider.extract(input.text, settings);
          if (!this.store.settings().autoLearn) return;
          for (const memory of extracted) this.store.add(memory, 'conversation');
        })
        .catch(() => {
          /* A learning failure must not fail the conversation. */
        });
      this.jobs.add(job);
      void job.finally(() => this.jobs.delete(job));
    }
    return {
      id: input.id,
      speaker: input.speaker,
      transcript: input.text,
      translation,
      reply,
      metrics,
    };
  }
  async drain() {
    await Promise.allSettled(this.jobs);
  }
  clear() {
    for (const turn of this.turns.values()) clearTimeout(turn.timer);
    this.turns.clear();
  }
}
