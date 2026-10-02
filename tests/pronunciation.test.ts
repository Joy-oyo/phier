import { describe, it, expect } from 'vitest';
import { kanaToIpa } from '../shared/kana-ipa';
import { validatePronunciation } from '../shared/validation';
import { GroqProvider } from '../server/providers/groq';
import { defaultSettings } from '../shared/types';
import { vi } from 'vitest';

describe('Japanese pronunciation formats', () => {
  it('Groq generates a kana reading then derives IPA from those exact words', async () => {
    const generate = vi
      .fn()
      .mockResolvedValue({
        responseText: 'テニス が すきです。',
        pronunciation: 'テニス が すきです。',
        meaning: 'I like tennis.',
        memoryIdsUsed: [],
        targetLanguage: 'ja',
        pronunciationMode: 'kana',
      });
    const pronounce = vi.fn();
    const provider = new GroqProvider('unused', 'unused', {
      generate,
      pronounce,
      translate: vi.fn(),
      extract: vi.fn(),
    });
    const reply = await provider.generate({
      text: 'スポーツは？',
      translation: 'Sports?',
      settings: { ...defaultSettings, pronunciationMode: 'ipa' },
      memories: [],
      recent: [],
    });
    expect(reply.pronunciation).toBe('/tenisɯ ɡa sɯkidesɯ/');
    expect(reply.pronunciationMode).toBe('ipa');
    expect(generate.mock.calls[0][0].settings.pronunciationMode).toBe('kana');
    expect(await provider.pronounce(reply.responseText, 'kana', 'English')).toBe(
      reply.responseText,
    );
    expect(pronounce).not.toHaveBeenCalled();
  });
  it('transcribes kana, loanwords, particles and gemination', () => {
    expect(kanaToIpa('テニス が すきです。')).toBe('/tenisɯ ɡa sɯkidesɯ/');
    expect(kanaToIpa('わたし は サッカー を します。')).toBe('/wataɕi wa sakkaː o ɕimasɯ/');
    expect(kanaToIpa('とうきょう へ いきます。')).toBe('/toːkʲoː e ikimasɯ/');
  });
  it('rejects kana in IPA, romaji, mismatched delimiters and punctuation-only kana', () => {
    for (const text of ['/suki desu/', '/すきです/', '/test]', '/123/'])
      expect(() => validatePronunciation(text, 'ipa')).toThrow();
    for (const text of ['好きです', 'suki', '。'])
      expect(() => validatePronunciation(text, 'kana')).toThrow();
    expect(() => validatePronunciation('/sɯki desɯ/', 'ipa')).not.toThrow();
  });
});
