import WebSocket from 'ws';
import type { AsrEvent, AsrProvider, AsrConnection } from './types';
import { safeProviderError } from './errors';

export function transcriptionConfiguration(model: string) {
  return {
    type: 'session.update',
    session: {
      type: 'transcription',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription:
            model === 'gpt-live-transcribe'
              ? { model, languages: ['ja', 'en'], delay: 'low' }
              : { model, language: 'ja' },
          turn_detection: null,
          noise_reduction: { type: 'near_field' },
        },
      },
    },
  };
}
export class OpenAIAsrProvider implements AsrProvider {
  constructor(
    private key: string,
    private model: string,
  ) {}
  connect(onEvent: (event: AsrEvent) => void): AsrConnection {
    const socket = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', {
      headers: { Authorization: `Bearer ${this.key}` },
      handshakeTimeout: 12_000,
    });
    let ready = false;
    let intentionalClose = false;
    const partials = new Map<string, string>();
    const send = (event: object) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
    };
    const timer = setTimeout(() => {
      onEvent({
        type: 'error',
        message: 'Speech connection timed out. Check your key and model access.',
      });
      socket.close();
    }, 15_000);
    socket.on('open', () => send(transcriptionConfiguration(this.model)));
    socket.on('message', (raw) => {
      try {
        const event = JSON.parse(raw.toString());
        if (event.type === 'session.updated' || event.type === 'transcription_session.updated') {
          clearTimeout(timer);
          ready = true;
          onEvent({ type: 'ready' });
        } else if (event.type === 'conversation.item.input_audio_transcription.delta') {
          const text = (partials.get(event.item_id) || '') + event.delta;
          partials.set(event.item_id, text.slice(-4000));
          onEvent({ type: 'partial', itemId: event.item_id, text });
        } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
          partials.delete(event.item_id);
          onEvent({ type: 'final', itemId: event.item_id, text: event.transcript });
        } else if (
          event.type === 'error' ||
          event.type === 'conversation.item.input_audio_transcription.failed'
        ) {
          onEvent({
            type: 'error',
            message: safeProviderError(event.error).message,
          });
        }
      } catch {
        onEvent({ type: 'error', message: 'The speech service returned an unreadable event.' });
      }
    });
    socket.on('error', () =>
      onEvent({
        type: 'error',
        message:
          'Could not connect to speech recognition. Check your network and API configuration.',
      }),
    );
    socket.on('close', () => {
      clearTimeout(timer);
      partials.clear();
      if (!intentionalClose)
        onEvent({
          type: 'error',
          message: 'Speech connection closed. Start listening to reconnect.',
        });
    });
    return {
      append(pcm) {
        if (ready) send({ type: 'input_audio_buffer.append', audio: pcm.toString('base64') });
      },
      commit() {
        if (ready) send({ type: 'input_audio_buffer.commit' });
      },
      clear() {
        if (ready) send({ type: 'input_audio_buffer.clear' });
        partials.clear();
      },
      close() {
        intentionalClose = true;
        clearTimeout(timer);
        partials.clear();
        socket.close();
      },
    };
  }
}
