import TRTC from 'trtc-sdk-v5';
import { RealtimeTranscriber } from 'trtc-sdk-v5/plugins/realtime-transcriber';
import type { RealtimeTranscriberMessageEvent } from 'trtc-sdk-v5';
import type { Settings, TrtcCredentials, TranslationText } from '../../shared/types';
import { api } from './api';

type Callbacks = {
  onReady(): void;
  onSpeech(): void;
  onCommit(): void;
  onLevel(level: number): void;
  onAudio?(bytes: number): void;
  onDevice?(label: string): void;
  onPartial(itemId: string, text: string, translations?: TranslationText[]): void;
  onFinal(itemId: string, text: string, translations?: TranslationText[]): void;
  onError(message: string): void;
};

const CONNECTION_TIMEOUT_MS = 20_000;
const TRTC_ERROR_MESSAGES: Record<number, string> = {
  2026: 'Speech-to-text and real-time translation are not enabled for this TRTC application. Enable them in the TRTC console and retry.',
  5001: 'The transcription service is over its concurrency limit. Try again in a moment, or contact TRTC to raise the limit.',
  '-102005': 'The TRTC room no longer exists. Start listening again.',
  '-102009': 'The TRTC session is no longer in the room. Start listening again.',
};

export function trtcErrorMessage(cause: unknown) {
  const error = cause as { code?: number; message?: string } | null;
  const known = error?.code === undefined ? undefined : TRTC_ERROR_MESSAGES[error.code];
  if (known) return known;
  if (error?.code === 5400) return error.message || 'The transcription service is unavailable.';
  const name = cause instanceof Error ? cause.name : '';
  if (name === 'NotAllowedError')
    return 'Microphone access was denied. Allow the microphone in your browser’s site permissions and in macOS System Settings → Privacy & Security → Microphone, then retry.';
  if (name === 'NotFoundError')
    return 'No microphone was found. Connect an input device and retry.';
  if (name === 'NotReadableError')
    return 'The microphone is unavailable. Check your system input device and close other apps using it, then retry.';
  return cause instanceof Error && cause.message
    ? cause.message
    : 'Real-time translation could not start. Check the TRTC settings and retry.';
}

/**
 * Streams the microphone through TRTC and reads back Japanese source text plus the
 * English (target-language) translation produced by the RealtimeTranscriber plugin.
 * https://trtc.io/document/79355 · https://trtc.io/document/59649
 */
export class TrtcSession {
  private client: TRTC | null = null;
  private robotId = '';
  private userId = '';
  private segment = '';
  private started = false;
  private stopped = false;
  private connectionTimer?: ReturnType<typeof setTimeout>;
  private handlePageHide = () =>
    this.fail('Listening stopped when you left the page. Start again to reconnect.');

  constructor(
    private targetLanguage: string,
    private events: Callbacks,
  ) {}

  async start() {
    if (this.started || this.stopped) return;
    this.started = true;
    try {
      if (!window.isSecureContext)
        throw new Error(
          'Real-time translation requires HTTPS or localhost. Open this app on localhost for local testing, or serve it over HTTPS.',
        );
      const credentials = await api<TrtcCredentials>(
        `/trtc/credentials?language=${encodeURIComponent(this.targetLanguage)}`,
      );
      if (this.stopped) return;
      this.userId = credentials.userId;
      const client = TRTC.create({ plugins: [RealtimeTranscriber] });
      this.client = client;
      client.on(TRTC.EVENT.REALTIME_TRANSCRIBER_MESSAGE, (event) => this.message(event));
      client.on(TRTC.EVENT.REALTIME_TRANSCRIBER_STATE_CHANGED, (event) => this.state(event));
      client.on(TRTC.EVENT.ERROR, (error) => {
        if (!this.stopped) this.fail(trtcErrorMessage(error));
      });
      client.on(TRTC.EVENT.KICKED_OUT, () =>
        this.fail('The real-time translation session was closed. Start listening again.'),
      );
      client.on(TRTC.EVENT.AUDIO_VOLUME, ({ result }) => {
        if (this.stopped) return;
        const mine = result.find((entry) => entry.userId === this.userId);
        if (mine) this.events.onLevel((Math.min(100, Math.max(0, mine.volume)) / 100) * 0.12);
      });
      window.addEventListener('pagehide', this.handlePageHide);
      this.connectionTimer = setTimeout(
        () =>
          this.fail(
            'Real-time translation timed out. Check the TRTC settings and your network, then retry.',
          ),
        CONNECTION_TIMEOUT_MS,
      );
      await client.enterRoom({
        sdkAppId: credentials.sdkAppId,
        userId: credentials.userId,
        userSig: credentials.userSig,
        roomId: credentials.roomId,
      });
      if (this.stopped) return;
      await client.startLocalAudio();
      if (this.stopped) return;
      this.events.onDevice?.('TRTC microphone');
      client.enableAudioVolumeEvaluation(200);
      const robotId = await client.startPlugin('RealtimeTranscriber', {
        sourceLanguage: credentials.sourceLanguage,
        translationLanguages: [credentials.targetLanguage],
        userIdsToTranscribe: 'all',
      });
      if (typeof robotId === 'string') this.robotId = robotId;
    } catch (error) {
      this.fail(trtcErrorMessage(error));
    }
  }

  private message(event: RealtimeTranscriberMessageEvent) {
    if (this.stopped) return;
    const { segmentId, sourceText, translationTexts, isCompleted } = event;
    if (segmentId !== this.segment) {
      this.segment = segmentId;
      this.events.onSpeech();
    }
    if (!sourceText.trim()) return;
    if (isCompleted) {
      this.segment = '';
      this.events.onCommit();
      this.events.onFinal(segmentId, sourceText, translationTexts ?? []);
    } else {
      this.events.onPartial(segmentId, sourceText, translationTexts ?? []);
    }
  }

  private state(event: { state: 'started' | 'stopped'; error?: number; errorMessage?: string }) {
    if (this.stopped) return;
    if (event.state === 'started') {
      clearTimeout(this.connectionTimer);
      this.events.onReady();
      return;
    }
    this.fail(
      event.error && TRTC_ERROR_MESSAGES[event.error]
        ? TRTC_ERROR_MESSAGES[event.error]
        : event.errorMessage || 'Real-time translation stopped unexpectedly. Start again.',
    );
  }

  resume() {
    this.segment = '';
  }
  resetTurn() {
    this.segment = '';
  }
  update(_settings: Settings) {}
  private fail(message: string) {
    if (this.stopped) return;
    this.stop();
    this.events.onError(message);
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.connectionTimer);
    window.removeEventListener('pagehide', this.handlePageHide);
    const client = this.client;
    const robotId = this.robotId;
    this.client = null;
    this.robotId = '';
    if (!client) return;
    void (async () => {
      try {
        if (robotId)
          await client.stopPlugin('RealtimeTranscriber', { transcriberRobotId: robotId });
      } catch {
        // The task ends with the room when the plugin is already gone.
      }
      try {
        await client.exitRoom();
      } catch {
        // Leaving an already-closed room is safe to ignore.
      }
      client.destroy();
    })();
  }
}
