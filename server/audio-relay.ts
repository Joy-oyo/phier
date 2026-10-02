import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'node:http';
import type { AsrConnection, AsrProvider } from './providers/types';

export function attachAudioRelay(
  server: Server,
  asr: AsrProvider | null,
  allowedOrigins: Set<string>,
  canConnect: () => boolean = () => true,
  path = '/api/audio',
) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    if (req.url?.split('?')[0] !== path) return; // Leave other relays and Vite HMR alone.
    if (
      !asr ||
      !canConnect() ||
      !allowedOrigins.has(req.headers.origin || '') ||
      wss.clients.size >= 2
    ) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (client) => {
    let upstream: AsrConnection | null = null;
    let ready = false;
    let bytes = 0;
    let committed = false;
    let finalizeTimer: ReturnType<typeof setTimeout> | undefined;
    const send = (event: object) => {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(event));
    };
    // Close unattended streams to bound cost. The user can reconnect.
    const sessionTimer = setTimeout(() => {
      send({
        type: 'error',
        message: 'The 15-minute listening session ended. Start again to continue.',
      });
      client.close();
    }, 15 * 60_000);
    upstream = asr!.connect((event) => {
      if (event.type === 'ready') ready = true;
      if (event.type === 'final') {
        committed = false;
        bytes = 0;
        clearTimeout(finalizeTimer);
      }
      send(event);
      if (event.type === 'error') client.close();
    });
    client.on('message', (raw, binary) => {
      if (!ready) return;
      if (binary) {
        if (committed) return;
        const pcm = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
        if (pcm.byteLength % 2 || bytes + pcm.byteLength > 48_000 * 35) {
          send({
            type: 'error',
            message: 'Audio turn was too long or malformed. Start listening again.',
          });
          client.close();
          return;
        }
        bytes += pcm.byteLength;
        upstream!.append(pcm);
      } else {
        try {
          const event = JSON.parse(raw.toString());
          if (event.type === 'commit' && !committed && bytes >= 4800) {
            committed = true;
            upstream!.commit();
            finalizeTimer = setTimeout(() => {
              send({
                type: 'error',
                message: 'Speech recognition took too long. Please reconnect.',
              });
              client.close();
            }, 20_000);
          } else if (event.type === 'clear' && !committed) {
            bytes = 0;
            upstream!.clear();
          }
        } catch {
          send({ type: 'error', message: 'Invalid audio message.' });
          client.close();
        }
      }
    });
    client.on('close', () => {
      clearTimeout(sessionTimer);
      clearTimeout(finalizeTimer);
      upstream?.close();
    });
    client.on('error', () => client.close());
  });
  return wss;
}
