import { ReplySchema, type Reply, type PronunciationMode } from './types';

// Kana, Japanese punctuation, prolonged sound mark and whitespace; never kanji/romaji.
export const kanaPattern = /^[\p{Script=Hiragana}\p{Script=Katakana}ー・、。！？「」『』（）\s]+$/u;
export function validatePronunciation(text: string, mode: PronunciationMode) {
  if (!text.trim() || text.length > 600) throw new Error('Pronunciation is empty or too long.');
  if (mode === 'kana') {
    if (!kanaPattern.test(text) || !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text))
      throw new Error('Pronunciation must contain hiragana and katakana only.');
    return;
  }
  // Structural IPA validation, not a claim of phonetic accuracy. Some valid IPA
  // consists entirely of Latin letters; do not require an arbitrary non-ASCII symbol.
  if (
    !/^(?:\/[^/]+\/|\[[^\[\]]+\])$/u.test(text) ||
    !/^[a-zɡɯɰɾɹɕʑʃʒçɸβθðŋɲɴɱʔʲʷːˑˈˌʰ̥̬̩̃͜͡\s./\[\](),]+$/u.test(text) ||
    !/[aeiouɯ]/u.test(text) ||
    /(?:sh|ch|tsu|[ruy]|aa|ii|uu|ee|oo)/u.test(text)
  )
    throw new Error(
      'Use Japanese IPA symbols, not romaji; enclose it in matching /slashes/ or [brackets].',
    );
}
export function validateReply(
  value: unknown,
  mode: PronunciationMode,
  allowedIds: string[],
): Reply {
  const reply = ReplySchema.parse(value);
  validatePronunciation(reply.pronunciation, mode);
  const sentences = reply.responseText.split(/[。！？!?]+/u).filter((s) => s.trim());
  if (sentences.length > 2) throw new Error('A reply must be at most two short sentences.');
  if (
    mode === 'kana' &&
    (!kanaPattern.test(reply.pronunciation) ||
      !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(reply.pronunciation))
  )
    throw new Error('Pronunciation must contain kana only.');
  if (mode === 'kana' && reply.pronunciation.split(/[。！？]+/u).filter((s) => s.trim()).length > 2)
    throw new Error('A reply must be at most two short sentences.');
  if (
    mode === 'ipa' &&
    (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(reply.pronunciation) ||
      !/^[/\[].+[/\]]$/u.test(reply.pronunciation))
  ) {
    throw new Error('IPA pronunciation must be bracketed phonetic text.');
  }
  if (reply.memoryIdsUsed.some((id) => !allowedIds.includes(id)))
    throw new Error('Reply referenced an unavailable memory.');
  return { ...reply, targetLanguage: 'ja', pronunciationMode: mode };
}
