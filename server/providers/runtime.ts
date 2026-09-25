import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'dotenv';
import {
  defaultSettings,
  type ConnectionStatus,
  type ServiceCheck,
  type Language,
  type Settings,
  type PronunciationMode,
} from '../../shared/types';
import { OpenAIProvider } from './openai';
import { OpenAIAsrProvider } from './asr';
import { MockProvider } from './mock';
import { ProviderError, safeProviderError } from './errors';
import { readTrtcConfig } from '../trtc';
import type { AsrProvider, AsrConnection, LanguageProvider, GenerationInput } from './types';

export interface RuntimeConfig {
  key?: string;
  mode: 'openai' | 'mock';
  demoEnabled: boolean;
  textModel: string;
  memoryModel: string;
  speechModel: string;
  trtcConfigured: boolean;
}
export function readLocalEnvironment() {
  let file: Record<string, string> = {};
  try {
    file = parse(readFileSync(resolve(process.env.PHIER_ENV_FILE || '.env')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return { ...file, ...process.env };
}
export function readRuntimeConfig(): RuntimeConfig {
  const env = readLocalEnvironment();
  // Fixtures require an explicit opt-in. Old PHIER_PROVIDER=mock settings alone cannot select them.
  const demoEnabled = env.PHIER_ENABLE_DEMO === 'true';
  const key = env.OPENAI_API_KEY?.trim();
  return {
    key: key && !/^(your[-_]|replace|paste)/i.test(key) ? key : undefined,
    mode: demoEnabled && env.PHIER_PROVIDER === 'mock' ? 'mock' : 'openai',
    demoEnabled,
    textModel: env.OPENAI_TEXT_MODEL || 'gpt-4.1-mini',
    memoryModel: env.OPENAI_MEMORY_MODEL || 'gpt-4.1-mini',
    speechModel: env.OPENAI_TRANSCRIBE_MODEL || 'gpt-live-transcribe',
    trtcConfigured: Boolean(readTrtcConfig(env)),
  };
}
const unchecked = (): ServiceCheck => ({
  status: 'unchecked',
  message: 'Not checked yet',
  latencyMs: null,
});
type Factory = (config: RuntimeConfig) => { language: LanguageProvider; speech: AsrProvider };

export class ProviderRuntime implements LanguageProvider {
  private config!: RuntimeConfig;
  private fingerprint = '';
  private language: LanguageProvider | null = null;
  private speech: AsrProvider | null = null;
  private status!: ConnectionStatus;
  private checking: Promise<ConnectionStatus> | null = null;
  constructor(
    private load = readRuntimeConfig,
    private factory: Factory = (c) => ({
      language: new OpenAIProvider(c.key!, c.textModel, c.memoryModel),
      speech: new OpenAIAsrProvider(c.key!, c.speechModel),
    }),
  ) {
    this.reload();
  }
  reload() {
    const config = this.load();
    const fingerprint = createHash('sha256').update(JSON.stringify(config)).digest('hex');
    if (fingerprint === this.fingerprint) return;
    this.fingerprint = fingerprint;
    this.config = config;
    const providers = config.key ? this.factory(config) : null;
    this.language = config.mode === 'mock' ? new MockProvider() : providers?.language || null;
    this.speech = config.mode === 'openai' ? providers?.speech || null : null;
    this.status = {
      configured: !!config.key,
      provider: config.mode,
      checkedAt: null,
      models: { text: config.textModel, memory: config.memoryModel, speech: config.speechModel },
      text: unchecked(),
      memory: unchecked(),
      speech: unchecked(),
    };
  }
  snapshot() {
    return structuredClone(this.status);
  }
  get mode() {
    return this.config.mode;
  }
  get demoEnabled() {
    return this.config.demoEnabled;
  }
  get liveAvailable() {
    if (this.mode !== 'openai') return false;
    // TRTC carries transcription and translation on its own, so a TRTC session does not
    // depend on the OpenAI speech check. Replies still need the text and memory models.
    if (this.config.trtcConfigured) return true;
    return (
      this.status.text.status === 'ready' &&
      this.status.memory.status === 'ready' &&
      this.status.speech.status === 'ready'
    );
  }
  get configurationError() {
    return !this.language
      ? 'Add your OpenAI API key to .env, then choose Check connection in Preferences.'
      : null;
  }
  private requireLanguage() {
    if (!this.language) throw new ProviderError(this.configurationError!, 503, 'missing_key');
    return this.language;
  }
  async translate(text: string, language: Language, signal?: AbortSignal) {
    try {
      return await this.requireLanguage().translate(text, language, signal);
    } catch (error) {
      throw safeProviderError(error);
    }
  }
  async generate(input: GenerationInput, signal?: AbortSignal) {
    try {
      return await this.requireLanguage().generate(input, signal);
    } catch (error) {
      throw safeProviderError(error);
    }
  }
  async pronounce(text: string, mode: PronunciationMode, languages: string, signal?: AbortSignal) {
    try {
      return await this.requireLanguage().pronounce(text, mode, languages, signal);
    } catch (error) {
      throw safeProviderError(error);
    }
  }
  async extract(text: string, settings: Settings) {
    try {
      return await this.requireLanguage().extract(text, settings);
    } catch (error) {
      throw safeProviderError(error);
    }
  }
  readonly asr: AsrProvider = {
    connect: (onEvent) => {
      if (!this.speech || !this.liveAvailable) {
        queueMicrotask(() =>
          onEvent({
            type: 'error',
            message: 'Check the text, memory and speech connections in Preferences first.',
          }),
        );
        return { append() {}, commit() {}, clear() {}, close() {} };
      }
      return this.speech.connect(onEvent);
    },
  };
  check(): Promise<ConnectionStatus> {
    if (this.checking) return this.checking;
    this.reload();
    if (this.mode === 'mock' || !this.language || !this.speech)
      return Promise.resolve(this.snapshot());
    const language = this.language,
      speech = this.speech;
    const run = async (name: 'text' | 'memory' | 'speech', operation: () => Promise<unknown>) => {
      this.status[name] = {
        status: 'checking',
        message: 'Checking provider access…',
        latencyMs: null,
      };
      const started = performance.now();
      try {
        await operation();
        this.status[name] = {
          status: 'ready',
          message:
            name === 'speech'
              ? 'Transcription session accepted; microphone audio has not been tested.'
              : 'Live model request succeeded.',
          latencyMs: Math.round(performance.now() - started),
        };
      } catch (error) {
        this.status[name] = {
          status: 'error',
          message: safeProviderError(error).message,
          latencyMs: Math.round(performance.now() - started),
        };
      }
    };
    this.checking = Promise.all([
      run('text', async () => {
        const text = 'こんにちは。';
        const translation = await language.translate(text, 'en');
        await language.generate({
          text,
          translation,
          settings: defaultSettings,
          memories: [],
          recent: [],
        });
      }),
      run('memory', () => language.extract('I enjoy reading books.', defaultSettings)),
      run(
        'speech',
        () =>
          new Promise<void>((resolve, reject) => {
            let connection: AsrConnection | undefined;
            let done = false;
            const finish = (error?: unknown) => {
              if (done) return;
              done = true;
              clearTimeout(timer);
              connection?.close();
              error ? reject(error) : resolve();
            };
            const timer = setTimeout(
              () =>
                finish(
                  new ProviderError(
                    'Speech connection timed out. Check network access and model permissions.',
                    504,
                    'timeout',
                  ),
                ),
              16_000,
            );
            connection = speech.connect((event) => {
              if (event.type === 'ready') finish();
              if (event.type === 'error') finish(new ProviderError(event.message));
            });
            if (done) connection.close();
          }),
      ),
    ])
      .then(() => {
        this.status.checkedAt = new Date().toISOString();
        return this.snapshot();
      })
      .finally(() => {
        this.checking = null;
      });
    return this.checking;
  }
}
