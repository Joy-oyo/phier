import express from 'express';
import { z, ZodError } from 'zod';
import { MemoryInputSchema, SettingsSchema, TurnSchema, type Settings } from '../shared/types';
import type { LanguageProvider } from './providers/types';
import { Store } from './store';
import { ConversationService } from './service';
import { MockProvider } from './providers/mock';
import { ProviderRuntime } from './providers/runtime';
import { ProviderError } from './providers/errors';
import { createTrtcCredentials, trtcTargetLanguages, type TrtcConfig } from './trtc';
import { knowledgeRoutes } from './knowledge-routes';
import type { KnowledgeProvider } from './knowledge-provider';

export function createApp(
  store: Store,
  provider: LanguageProvider,
  config: {
    runtime: ProviderRuntime;
    port: number;
    trtc: TrtcConfig | null;
    knowledge?: KnowledgeProvider;
  },
) {
  const app = express();
  const service = new ConversationService(store, provider, () => config.runtime.demoEnabled);
  const origins = new Set([`http://localhost:${config.port}`, `http://127.0.0.1:${config.port}`]);
  app.disable('x-powered-by');
  app.use('/api', (req, res, next) => {
    const host = req.headers.host;
    if (!host || ![`localhost:${config.port}`, `127.0.0.1:${config.port}`].includes(host)) {
      res.status(403).json({ error: 'Local access only.' });
      return;
    }
    if (req.headers.origin && !origins.has(req.headers.origin)) {
      res.status(403).json({ error: 'Origin not allowed.' });
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-phier-client'] !== '1') {
      res.status(403).json({ error: 'Missing application request header.' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/knowledge', knowledgeRoutes(store, config.knowledge));
  app.get('/api/bootstrap', (_req, res) =>
    res.json({
      settings: store.settings(),
      memories: store.memories(),
      provider: config.runtime.mode,
      liveAvailable: config.runtime.liveAvailable,
      configurationError: config.runtime.configurationError,
      demoEnabled: config.runtime.demoEnabled,
      connection: config.runtime.snapshot(),
      trtc: {
        configured: config.runtime.mode !== 'local' && Boolean(config.trtc),
        sourceLanguage: config.trtc?.sourceLanguage ?? 'ja',
        targetLanguage: config.trtc?.targetLanguage ?? 'en',
      },
    }),
  );
  app.get('/api/trtc/credentials', (req, res) => {
    if (!config.trtc) {
      res.status(503).json({
        error:
          'Real-time translation is not configured. Add TRTC_SDK_APP_ID and TRTC_SDK_SECRET_KEY to .env, then restart.',
      });
      return;
    }
    const requested = typeof req.query.language === 'string' ? req.query.language : '';
    const targetLanguage = (trtcTargetLanguages as readonly string[]).includes(requested)
      ? requested
      : config.trtc.targetLanguage;
    res.json(createTrtcCredentials(config.trtc, targetLanguage));
  });
  app.post('/api/connection/check', async (_req, res) => res.json(await config.runtime.check()));
  app.get('/api/connection', (_req, res) => res.json(config.runtime.snapshot()));
  app.put('/api/settings', (req, res) =>
    res.json(store.saveSettings(SettingsSchema.parse(req.body))),
  );
  app.get('/api/memories', (_req, res) => res.json(store.memories()));
  app.post('/api/memories', (req, res) =>
    res.status(201).json(store.add(MemoryInputSchema.parse(req.body), 'manual', true)),
  );
  app.put('/api/memories/:id', (req, res) =>
    res.json(store.update(req.params.id, MemoryInputSchema.parse(req.body))),
  );
  app.post('/api/memories/:id/approve', (req, res) => res.json(store.approve(req.params.id)));
  app.delete('/api/memories/:id', (req, res) => {
    store.remove(req.params.id);
    res.status(204).end();
  });
  let activeRequests = 0;
  app.use(
    ['/api/turn', '/api/translate', '/api/onboarding', '/api/pronounce'],
    (req, res, next) => {
      if (activeRequests >= 4) {
        res
          .status(429)
          .json({ error: 'Please wait for the current conversation to finish processing.' });
        return;
      }
      activeRequests++;
      res.once('close', () => activeRequests--);
      if (req.body?.demo && !config.runtime.demoEnabled) {
        res.status(403).json({ error: 'Sample data is disabled. Use the live provider.' });
        return;
      }
      if (config.runtime.configurationError && !req.body?.demo) {
        res.status(503).json({ error: config.runtime.configurationError });
        return;
      }
      next();
    },
  );
  app.post('/api/turn', async (req, res) => {
    const input = TurnSchema.parse(req.body);
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    res.json(await service.process(input, controller.signal));
  });
  app.post('/api/translate', async (req, res) => {
    const { text, language, demo } = z
      .object({
        text: z.string().min(1).max(2000),
        language: SettingsSchema.shape.explanationLanguage,
        demo: z.boolean().default(false),
      })
      .parse(req.body);
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    res.json({
      translation: await (demo ? new MockProvider() : provider).translate(
        text,
        language,
        controller.signal,
      ),
    });
  });
  app.post('/api/pronounce', async (req, res) => {
    const { text, mode, demo } = z
      .object({
        text: z.string().min(1).max(180),
        mode: z.enum(['kana', 'ipa']),
        demo: z.boolean().default(false),
      })
      .parse(req.body);
    res.json({
      pronunciation: await (demo ? new MockProvider() : provider).pronounce(
        text,
        mode,
        store.settings().spokenLanguages,
      ),
    });
  });
  app.post('/api/onboarding', async (req, res) => {
    const { text } = z.object({ text: z.string().min(1).max(4000) }).parse(req.body);
    const current = store.settings();
    const memories = await provider.extract(text, current);
    const settings: Settings = { ...current };
    const spoken = memories
      .filter((m) => m.category === 'language')
      .map((m) => m.content.replace(/^I speak |\.$/g, ''));
    if (spoken.length) settings.spokenLanguages = spoken.join(', ');
    if (/\bIPA\b/i.test(text)) settings.pronunciationMode = 'ipa';
    if (/\bkana\b|hiragana|katakana/i.test(text)) settings.pronunciationMode = 'kana';
    const language =
      /(?:explain|explanations?|translations?|meaning).*?\b(English|Chinese|Mandarin|Spanish|French|German)\b/i
        .exec(text)?.[1]
        ?.toLowerCase();
    const mapping: Record<string, Settings['explanationLanguage']> = {
      english: 'en',
      chinese: 'zh',
      mandarin: 'zh',
      spanish: 'es',
      french: 'fr',
      german: 'de',
    };
    if (language) settings.explanationLanguage = mapping[language];
    res.json({ memories, settings });
  });
  app.post('/api/onboarding/complete', (req, res) => {
    const { memories, settings } = z
      .object({ memories: z.array(MemoryInputSchema).max(20), settings: SettingsSchema })
      .parse(req.body);
    for (const memory of memories) store.add(memory, 'onboarding', true);
    store.saveSettings({ ...settings, onboarded: true });
    res.json({ memories: store.memories(), settings: store.settings() });
  });
  app.post('/api/session/end', (_req, res) => {
    service.clear();
    res.status(204).end();
  });
  app.get('/api/metrics', (_req, res) => res.json(store.metrics()));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown endpoint.' }));
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (error instanceof ProviderError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      if (error instanceof ZodError) {
        res.status(400).json({
          error: 'Please check the input values.',
          issues: error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
        return;
      }
      const message = error instanceof Error ? error.message : 'Something went wrong.';
      const publicMessage =
        /sample mode|connect a provider|memory not found|already exists|too many recent|pronunciation conversion/i.test(
          message,
        )
          ? message
          : 'Could not complete this request. Check your connection and provider configuration, then try again.';
      res.status(/memory not found/i.test(message) ? 404 : 502).json({ error: publicMessage });
    },
  );
  return { app, service, origins };
}
