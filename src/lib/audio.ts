import { VoiceDetector } from './vad';
import type { Settings, TranslationText } from '../../shared/types';

export type Callbacks = {
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
export function microphoneError(cause: unknown) {
  const name = cause instanceof Error ? cause.name : '';
  if (name === 'NotAllowedError')
    return 'Microphone access was denied. Allow the microphone in your browser’s site permissions and in macOS System Settings → Privacy & Security → Microphone. If this embedded browser cannot prompt, open localhost:5173 in Chrome or Safari, then retry.';
  if (name === 'NotFoundError')
    return 'No microphone was found. Connect an input device and retry.';
  if (name === 'NotReadableError')
    return 'The microphone is unavailable. Check your system input device and close other apps using it, then retry.';
  if (name === 'OverconstrainedError')
    return 'This microphone cannot use the requested audio settings. Choose another system input device and retry.';
  return cause instanceof Error ? cause.message : 'Unable to start the microphone.';
}
export class Microphone {
  private stream?: MediaStream;
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private socket?: WebSocket;
  private stopped = false;
  private paused = false;
  private connected = false;
  private started = false;
  private connectionTimer?: ReturnType<typeof setTimeout>;
  private handlePageHide = () =>
    this.fail('Microphone stopped when you left the page. Start again to reconnect.');
  private preRoll: ArrayBuffer[] = [];
  private vad: VoiceDetector;
  constructor(
    settings: Settings,
    private events: Callbacks,
    private options: { localOnly?: boolean } = {},
  ) {
    this.vad = new VoiceDetector(settings.silenceMs, settings.vadThreshold);
  }
  async start() {
    if (this.started || this.stopped) return;
    this.started = true;
    try {
      if (!window.isSecureContext)
        throw new Error(
          'Microphone access requires HTTPS or localhost. Open this app on localhost for local testing, or serve it over HTTPS.',
        );
      const policy = document as Document & {
        permissionsPolicy?: { allowsFeature(name: string): boolean };
        featurePolicy?: { allowsFeature(name: string): boolean };
      };
      if ((policy.permissionsPolicy || policy.featurePolicy)?.allowsFeature('microphone') === false)
        throw new Error(
          'Microphone access is blocked by the embedding page’s Permissions Policy. Open this app directly in Chrome or Safari, or have the host explicitly allow microphone access.',
        );
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error('Microphone access requires localhost or HTTPS in a supported browser.');
      if (typeof AudioContext === 'undefined' || typeof AudioWorkletNode === 'undefined')
        throw new Error(
          'Streaming audio is not supported in this browser. Open this app in a current Chrome or Safari browser.',
        );
      // Unlock Web Audio during the click, before waiting for the permission prompt.
      this.context = new AudioContext({ sampleRate: 24000 });
      void this.context.resume().catch((error) => this.fail(microphoneError(error)));
      window.addEventListener('pagehide', this.handlePageHide);
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (this.stopped) {
        this.stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream
        .getTracks()
        .forEach((track) =>
          track.addEventListener('ended', () =>
            this.fail('The microphone disconnected. Choose an input device and try again.'),
          ),
        );
      const track = this.stream.getAudioTracks()[0];
      if (!track || track.readyState !== 'live')
        throw new Error(
          'No active microphone audio track is available. Reconnect your input device and retry.',
        );
      this.events.onDevice?.(track.label || 'Default microphone');
      if (this.context.sampleRate !== 24000)
        throw new Error('This browser cannot capture at 24 kHz. Please try Chrome.');
      await this.context.audioWorklet.addModule('/audio-worklet.js');
      if (this.stopped) return;
      this.node = new AudioWorkletNode(this.context, 'phier-capture');
      const source = this.context.createMediaStreamSource(this.stream);
      const silent = this.context.createGain();
      silent.gain.value = 0;
      source.connect(this.node);
      this.node.connect(silent);
      silent.connect(this.context.destination);
      this.node.port.onmessage = ({ data }: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) =>
        this.frame(data.pcm, data.rms);
      this.node.onprocessorerror = () =>
        this.fail(
          'Audio capture stopped unexpectedly. Restart the microphone test or listening session.',
        );
      await this.context.resume();
      if (this.stopped) return;
      if (this.context.state !== 'running')
        throw new Error(
          'The browser paused audio capture. Click Start again, or open this app directly in Chrome or Safari.',
        );
      this.context.onstatechange = () => {
        if (!this.stopped && this.context?.state !== 'running')
          this.fail(
            'Audio capture was interrupted by the browser or system. Start the microphone again to resume.',
          );
      };
      if (this.options.localOnly) {
        this.events.onReady();
        return;
      }
      this.socket = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/audio`,
      );
      this.connectionTimer = setTimeout(
        () =>
          this.fail(
            'The speech connection timed out. Your microphone was released; check the connection and retry.',
          ),
        20_000,
      );
      this.socket.onmessage = (event) => {
        if (this.stopped) return;
        let value;
        try {
          value = JSON.parse(event.data);
        } catch {
          this.fail('The speech connection returned an invalid message. Restart listening.');
          return;
        }
        if (value.type === 'ready') {
          clearTimeout(this.connectionTimer);
          this.connected = true;
          this.events.onReady();
        }
        if (value.type === 'partial') this.events.onPartial(value.itemId, value.text);
        if (value.type === 'final') this.events.onFinal(value.itemId, value.text);
        if (value.type === 'error') this.fail(value.message);
      };
      this.socket.onerror = () =>
        this.fail('Could not connect to live speech. Check the provider settings and try again.');
      this.socket.onclose = () => {
        if (!this.stopped) this.fail('Listening disconnected. Start again to reconnect.');
      };
    } catch (error) {
      this.fail(microphoneError(error));
    }
  }
  private frame(pcm: ArrayBuffer, rms: number) {
    if (this.stopped) return;
    this.events.onLevel(rms);
    if (this.options.localOnly) {
      this.events.onAudio?.(pcm.byteLength);
      return;
    }
    if (!this.connected || this.paused) return;
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const wasSpeaking = this.vad.speaking;
    const event = this.vad.consume(rms, 20);
    if (!wasSpeaking) {
      this.preRoll.push(pcm);
      if (this.preRoll.length > 15) this.preRoll.shift();
    }
    if (event === 'start') {
      this.events.onSpeech();
      for (const frame of this.preRoll) {
        this.socket.send(frame);
        this.events.onAudio?.(frame.byteLength);
      }
      this.preRoll = [];
    } else if (wasSpeaking) {
      if (this.socket.bufferedAmount > 512_000) {
        this.fail('The network cannot keep up with audio. Please reconnect.');
        return;
      }
      this.socket.send(pcm);
      this.events.onAudio?.(pcm.byteLength);
    }
    if (event === 'end') {
      this.paused = true;
      this.socket.send(JSON.stringify({ type: 'commit' }));
      this.events.onCommit();
    }
  }
  resume() {
    this.paused = false;
    this.vad.reset();
    this.preRoll = [];
  }
  resetTurn() {
    if (!this.paused) {
      this.vad.reset();
      this.preRoll = [];
      if (this.socket?.readyState === WebSocket.OPEN)
        this.socket.send(JSON.stringify({ type: 'clear' }));
    }
  }
  update(settings: Settings) {
    this.vad.silenceMs = settings.silenceMs;
    this.vad.threshold = settings.vadThreshold;
  }
  private fail(message: string) {
    if (this.stopped) return;
    this.stop();
    this.events.onError(message);
  }
  stop() {
    this.stopped = true;
    this.connected = false;
    clearTimeout(this.connectionTimer);
    window.removeEventListener('pagehide', this.handlePageHide);
    this.preRoll = [];
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.socket?.close();
    if (this.context && this.context.state !== 'closed') void this.context.close();
  }
}
