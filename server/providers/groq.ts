import type { Language, MemoryInput, PronunciationMode, Settings } from '../../shared/types';
import type { GenerationInput, LanguageProvider } from './types';
import { OpenAIProvider } from './openai';
import { kanaToIpa } from '../../shared/kana-ipa';
import { kanaPattern, validatePronunciation } from '../../shared/validation';

/**
 * Free-MVP Groq adapter. Saved personal memories are deliberately not exported
 * to Groq, and automatic memory extraction remains disabled for this provider.
 */
export class GroqProvider implements LanguageProvider {
  private provider: LanguageProvider;

  constructor(key: string, model = 'qwen/qwen3.8-27b', provider?: LanguageProvider) {
    this.provider =
      provider || new OpenAIProvider(key, model, model, 'https://api.groq.com/openai/v1');
  }

  translate(text: string, language: Language, signal?: AbortSignal) {
    return this.provider.translate(text, language, signal);
  }

  async generate(input: GenerationInput, signal?: AbortSignal) {
    const reply = await this.provider.generate(
      { ...input, settings: { ...input.settings, pronunciationMode: 'kana' }, memories: [] },
      signal,
    );
    return input.settings.pronunciationMode === 'ipa'
      ? {
          ...reply,
          pronunciation: kanaToIpa(reply.pronunciation),
          pronunciationMode: 'ipa' as const,
        }
      : reply;
  }

  async pronounce(
    text: string,
    mode: PronunciationMode,
    spokenLanguages: string,
    signal?: AbortSignal,
  ) {
    const kana = kanaPattern.test(text)
      ? text
      : await this.provider.pronounce(text, 'kana', spokenLanguages, signal);
    validatePronunciation(kana, 'kana');
    return mode === 'kana' ? kana : kanaToIpa(kana);
  }

  async extract(_text: string, _settings: Settings): Promise<MemoryInput[]> {
    return [];
  }
}
