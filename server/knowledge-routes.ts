import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { KnowledgeInputSchema, type KnowledgeEvent } from '../shared/knowledge';
import { Store } from './store';
import type { KnowledgeProvider } from './knowledge-provider';
import { KnowledgeRuntime } from './knowledge-runtime';
import { safeProviderError } from './providers/errors';

export function knowledgeRoutes(
  store: Store,
  provider: KnowledgeProvider = new KnowledgeRuntime(),
) {
  const router = Router();
  const active = new Set<string>();
  router.use((req, res, next) => {
    const cookie = req.headers.cookie
      ?.split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith('phier_library='))
      ?.slice('phier_library='.length);
    const token =
      cookie && /^[a-f0-9]{64}$/.test(cookie) ? cookie : randomBytes(32).toString('hex');
    if (token !== cookie)
      res.cookie('phier_library', token, {
        httpOnly: true,
        sameSite: 'strict',
        path: '/api/knowledge',
        maxAge: 365 * 24 * 60 * 60 * 1000,
        secure: req.secure,
      });
    res.locals.owner = createHash('sha256').update(token).digest('hex');
    next();
  });
  router.get('/status', (_req, res) => res.json(provider.status()));
  router.get('/library', (req, res) => {
    const offset = z.coerce.number().int().min(0).max(1_000_000).default(0).parse(req.query.offset);
    const entries = store.knowledge(res.locals.owner, undefined, 51, offset);
    res.json({
      entries: entries.slice(0, 50),
      nextOffset: entries.length > 50 ? offset + 50 : null,
    });
  });
  router.delete('/library/:id', (req, res) => {
    store.deleteKnowledge(res.locals.owner, z.string().uuid().parse(req.params.id));
    res.status(204).end();
  });
  router.post('/analyze', async (req, res) => {
    const input = KnowledgeInputSchema.parse(req.body);
    const owner = res.locals.owner as string;
    if (active.has(owner) || active.size >= 4) {
      res.status(429).json({ error: 'Research is still in progress. Please retry shortly.' });
      return;
    }
    const previous = store.knowledgeEntry(owner, input.id);
    if (previous && (previous.text !== input.text || previous.sessionId !== input.sessionId)) {
      res.status(409).json({ error: 'This passage ID has already been used.' });
      return;
    }
    if (!previous && !provider.status().configured) {
      res.status(503).json({ error: provider.status().message });
      return;
    }
    active.add(owner);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error('Research timed out. Retry this passage.')),
      150_000,
    );
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const send = (event: KnowledgeEvent) => {
      if (!res.destroyed) res.write(JSON.stringify(event) + '\n');
    };
    try {
      if (previous) {
        send({ type: 'complete', entry: previous });
        return;
      }
      const recent = store.knowledge(owner, input.sessionId, 4).reverse();
      const topics = await provider.detect(input.text, recent, controller.signal);
      controller.signal.throwIfAborted();
      send({ type: 'keywords', topics });
      const result = topics.length
        ? await provider.research(input.text, topics, recent, controller.signal)
        : { cards: [], questions: [] };
      controller.signal.throwIfAborted();
      const entry = { ...input, ...result, createdAt: new Date().toISOString() };
      // Only useful results become permanent library entries; incidental speech stays transient.
      if (entry.cards.length) store.saveKnowledge(owner, entry);
      send({ type: 'complete', entry });
    } catch (error) {
      send({
        type: 'error',
        message: controller.signal.aborted
          ? 'Research was interrupted. Retry this passage.'
          : safeProviderError(error).message,
      });
    } finally {
      clearTimeout(timeout);
      active.delete(owner);
      res.end();
    }
  });
  return router;
}
