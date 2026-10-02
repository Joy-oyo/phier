import { validatePronunciation } from './validation';

// Broad mora-based Japanese transcription. This does not model pitch accent,
// vowel devoicing or every dialectal allophone. Unsupported kana fail explicitly.
const rows = [
  ['あいうえお', ['a', 'i', 'ɯ', 'e', 'o']],
  ['かきくけこ', ['ka', 'ki', 'kɯ', 'ke', 'ko']],
  ['がぎぐげご', ['ɡa', 'ɡi', 'ɡɯ', 'ɡe', 'ɡo']],
  ['さしすせそ', ['sa', 'ɕi', 'sɯ', 'se', 'so']],
  ['ざじずぜぞ', ['za', 'dʑi', 'zɯ', 'ze', 'zo']],
  ['たちつてと', ['ta', 'tɕi', 'tsɯ', 'te', 'to']],
  ['だぢづでど', ['da', 'dʑi', 'zɯ', 'de', 'do']],
  ['なにぬねの', ['na', 'ni', 'nɯ', 'ne', 'no']],
  ['はひふへほ', ['ha', 'çi', 'ɸɯ', 'he', 'ho']],
  ['ばびぶべぼ', ['ba', 'bi', 'bɯ', 'be', 'bo']],
  ['ぱぴぷぺぽ', ['pa', 'pi', 'pɯ', 'pe', 'po']],
  ['まみむめも', ['ma', 'mi', 'mɯ', 'me', 'mo']],
  ['やゆよ', ['ja', 'jɯ', 'jo']],
  ['らりるれろ', ['ɾa', 'ɾi', 'ɾɯ', 'ɾe', 'ɾo']],
  ['わゐゑをんゔ', ['wa', 'i', 'e', 'o', 'ɴ', 'vɯ']],
] as const;
const mora: Record<string, string> = {};
for (const [kana, sounds] of rows)
  [...kana].forEach((c, i) => {
    mora[c] = sounds[i];
  });
for (const [base, sound] of Object.entries({
  き: 'kʲ',
  ぎ: 'ɡʲ',
  し: 'ɕ',
  じ: 'dʑ',
  ち: 'tɕ',
  ぢ: 'dʑ',
  に: 'nʲ',
  ひ: 'ç',
  び: 'bʲ',
  ぴ: 'pʲ',
  み: 'mʲ',
  り: 'ɾʲ',
}))
  for (const [small, vowel] of Object.entries({ ゃ: 'a', ゅ: 'ɯ', ょ: 'o' }))
    mora[base + small] = sound + vowel;
Object.assign(mora, {
  ふぁ: 'ɸa',
  ふぃ: 'ɸi',
  ふぇ: 'ɸe',
  ふぉ: 'ɸo',
  てぃ: 'ti',
  でぃ: 'di',
  とぅ: 'tɯ',
  どぅ: 'dɯ',
  しぇ: 'ɕe',
  じぇ: 'dʑe',
  ちぇ: 'tɕe',
  うぃ: 'wi',
  うぇ: 'we',
  うぉ: 'wo',
  ゔぁ: 'va',
  ゔぃ: 'vi',
  ゔぇ: 've',
  ゔぉ: 'vo',
  つぁ: 'tsa',
  つぃ: 'tsi',
  つぇ: 'tse',
  つぉ: 'tso',
});

export function kanaToIpa(kana: string): string {
  validatePronunciation(kana, 'kana');
  const hiragana = kana
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const words = hiragana
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      // The generator separates particles so their conventional spelling remains
      // readable in kana, while their spoken forms are used here.
      if (word === 'は') return 'wa';
      if (word === 'へ') return 'e';
      word = word.replace(/こんにちは/g, 'こんにちわ').replace(/こんばんは/g, 'こんばんわ');
      let out = '';
      let geminate = false;
      for (let i = 0; i < word.length; i++) {
        const c = word[i];
        if (/[・、。！？「」『』（）]/.test(c)) {
          out += ' ';
          continue;
        }
        if (c === 'っ') {
          geminate = true;
          continue;
        }
        if (c === 'ー') {
          if (!/[aiɯeo]$/.test(out)) throw new Error('Cannot transcribe this long vowel.');
          out += 'ː';
          continue;
        }
        const pair = mora[word.slice(i, i + 2)];
        const sound = pair || mora[c];
        if (!sound) throw new Error('This kana reading cannot yet be converted to IPA.');
        if (pair) i++;
        if (geminate) {
          if (!/^[kstpɕtɕ]/.test(sound)) throw new Error('Unsupported doubled consonant.');
          out += sound[0] === 't' ? 't' : sound[0];
          geminate = false;
        }
        out += sound;
      }
      if (geminate) throw new Error('Incomplete kana reading.');
      return out;
    });
  const result =
    '/' +
    words
      .join(' ')
      .replace(/aa/g, 'aː')
      .replace(/ii/g, 'iː')
      .replace(/ɯɯ/g, 'ɯː')
      .replace(/ee/g, 'eː')
      .replace(/oo|oɯ/g, 'oː')
      .replace(/\s+/g, ' ')
      .trim() +
    '/';
  validatePronunciation(result, 'ipa');
  return result;
}
