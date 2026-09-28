import { ReplySchema, type Reply, type PronunciationMode } from './types';

// Kana, Japanese punctuation, prolonged sound mark and whitespace; never kanji/romaji.
export const kanaPattern = /^[\p{Script=Hiragana}\p{Script=Katakana}ー・、。！？「」『』（）\s]+$/u;
export function validateReply(
  value: unknown,
  mode: PronunciationMode,
  allowedIds: string[],
): Reply {
  const reply = ReplySchema.parse(value);
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
