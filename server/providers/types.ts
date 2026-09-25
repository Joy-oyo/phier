import type {
  Memory,
  MemoryInput,
  Settings,
  Reply,
  Language,
  PronunciationMode,
} from '../../shared/types';

export interface GenerationInput {
  text: string;
  translation: string;
  settings: Settings;
  memories: Memory[];
  recent: { speaker: 'partner' | 'user'; text: string }[];
}
export interface TranslationProvider {
  translate(text: string, language: Language, signal?: AbortSignal): Promise<string>;
}
export interface ResponseProvider {
  generate(input: GenerationInput, signal?: AbortSignal): Promise<Reply>;
}
export interface PronunciationProvider {
  pronounce(
    text: string,
    mode: PronunciationMode,
    languages: string,
    signal?: AbortSignal,
  ): Promise<string>;
}
export interface MemoryProvider {
  extract(text: string, settings: Settings): Promise<MemoryInput[]>;
}
export interface LanguageProvider
  extends TranslationProvider, ResponseProvider, PronunciationProvider, MemoryProvider {}
export type AsrEvent =
  | { type: 'ready' }
  | { type: 'partial' | 'final'; itemId: string; text: string }
  | { type: 'error'; message: string };
export interface AsrConnection {
  append(pcm: Buffer): void;
  commit(): void;
  clear(): void;
  close(): void;
}
export interface AsrProvider {
  connect(onEvent: (event: AsrEvent) => void): AsrConnection;
}
