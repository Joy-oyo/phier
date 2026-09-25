import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import { Store } from './store';
import { ProviderRuntime, readLocalEnvironment } from './providers/runtime';
import { createApp } from './app';
import { attachAudioRelay } from './audio-relay';
import { readTrtcConfig } from './trtc';

const localEnvironment = readLocalEnvironment();
const trtc = readTrtcConfig(localEnvironment);
const port = Number(localEnvironment.PORT || 5173);
const store = new Store(localEnvironment.PHIER_DB_PATH || './data/phier.sqlite');
const provider = new ProviderRuntime();
const { app, service, origins } = createApp(store, provider, {
  port,
  runtime: provider,
  trtc,
});
const server = createServer(app);
const audio = attachAudioRelay(server, provider.asr, origins, () => provider.liveAvailable);
// An embedding host must still delegate microphone permission to its frame.
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=()');
  next();
});
let vite: import('vite').ViteDevServer | undefined;
const production = process.argv[1]?.endsWith('server.mjs');
if (!production) {
  const { createServer: createViteServer } = await import('vite');
  vite = await createViteServer({
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  if (!existsSync('dist/index.html')) throw new Error('Run npm run build before npm start.');
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
}
server.listen(port, '127.0.0.1', () =>
  console.log(
    `phier → http://localhost:${port} · ${provider.mode === 'mock' ? 'explicit development fixtures' : 'live provider'}`,
  ),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  for (const socket of audio.clients) socket.close();
  audio.close();
  service.clear();
  await service.drain();
  await vite?.close();
  server.close();
  store.close();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
