import {
  samples,
  type Language,
  type MemoryInput,
  type PronunciationMode,
  type Settings,
} from '../../shared/types';
import { validateReply } from '../../shared/validation';
import type { GenerationInput, LanguageProvider } from './types';

const sampleTranslations: Record<string, Record<Language, string>> = {
  weekend: {
    en: samples[0].meaning,
    zh: '你周末通常做什么？',
    es: '¿Qué sueles hacer los fines de semana?',
    fr: 'Que fais-tu habituellement le week-end ?',
    de: 'Was machst du normalerweise am Wochenende?',
  },
  work: {
    en: samples[1].meaning,
    zh: '你从事什么工作？',
    es: '¿A qué te dedicas?',
    fr: 'Que faites-vous dans la vie ?',
    de: 'Was machen Sie beruflich?',
  },
  coffee: {
    en: samples[2].meaning,
    zh: '你休息日喜欢做什么？',
    es: '¿Qué te gusta hacer en tus días libres?',
    fr: 'Que fais-tu pendant tes jours de repos ?',
    de: 'Was machst du gerne an deinen freien Tagen?',
  },
  background: {
    en: samples[3].meaning,
    zh: '你来自哪里？',
    es: '¿De dónde eres?',
    fr: 'D’où viens-tu ?',
    de: 'Woher kommst du?',
  },
};
type Phrase = {
  text: string;
  kana: string;
  casual?: string;
  ipa: string;
  meaning: Record<Language, string>;
};
const phrases: Record<string, Phrase> = {
  neutral: {
    text: 'あなたはどうですか？',
    kana: 'あなたは どうですか？',
    ipa: '/anata wa doː desɯ ka/',
    meaning: { en: 'How about you?', zh: '你呢？', es: '¿Y tú?', fr: 'Et vous ?', de: 'Und du?' },
  },
  golf: {
    text: 'ゴルフが好きです。',
    kana: 'ゴルフが すきです。',
    casual: 'ゴルフが すき。',
    ipa: '/ɡoɾɯɸɯ ɡa sɯki desɯ/',
    meaning: {
      en: 'I like golf.',
      zh: '我喜欢高尔夫。',
      es: 'Me gusta el golf.',
      fr: 'J’aime le golf.',
      de: 'Ich spiele gerne Golf.',
    },
  },
  tennis: {
    text: 'テニスが好きです。',
    kana: 'テニスが すきです。',
    casual: 'テニスが すき。',
    ipa: '/tenisɯ ɡa sɯki desɯ/',
    meaning: {
      en: 'I like tennis.',
      zh: '我喜欢网球。',
      es: 'Me gusta el tenis.',
      fr: 'J’aime le tennis.',
      de: 'Ich spiele gerne Tennis.',
    },
  },
  both: {
    text: 'ゴルフやテニスが好きです。',
    kana: 'ゴルフや テニスが すきです。',
    casual: 'ゴルフや テニスが すき。',
    ipa: '/ɡoɾɯɸɯ ja tenisɯ ɡa sɯki desɯ/',
    meaning: {
      en: 'I like golf and tennis.',
      zh: '我喜欢高尔夫和网球。',
      es: 'Me gustan el golf y el tenis.',
      fr: 'J’aime le golf et le tennis.',
      de: 'Ich spiele gerne Golf und Tennis.',
    },
  },
  chinese: {
    text: '中国出身です。',
    kana: 'ちゅうごく しゅっしんです。',
    casual: 'ちゅうごく しゅっしん。',
    ipa: '/tɕɯːɡokɯ ɕɯɕːin desɯ/',
    meaning: {
      en: 'I’m from China.',
      zh: '我来自中国。',
      es: 'Soy de China.',
      fr: 'Je viens de Chine.',
      de: 'Ich komme aus China.',
    },
  },
  designer: {
    text: 'デザイナーをしています。',
    kana: 'デザイナーを しています。',
    ipa: '/dezainaː o ɕite imasɯ/',
    meaning: {
      en: 'I work as a designer.',
      zh: '我是一名设计师。',
      es: 'Trabajo como diseñador.',
      fr: 'Je travaille dans le design.',
      de: 'Ich arbeite im Design.',
    },
  },
};

export class MockProvider implements LanguageProvider {
  async translate(text: string, language: Language) {
    const sample = samples.find((s) => s.text === text);
    if (sample) return sampleTranslations[sample.id][language];
    // Development mode never pretends to translate arbitrary input.
    return text;
  }
  async generate(input: GenerationInput) {
    const sample = samples.find((s) => s.text === input.text);
    if (!sample)
      throw new Error(
        'Sample mode supports the four example conversations. Connect a cloud provider for other Japanese text.',
      );
    const used: string[] = [];
    let key = 'neutral';
    const find = (pattern: RegExp) =>
      input.memories.find(
        (m) => pattern.test(m.content) && !/\b(not|dislike|no longer)\b/i.test(m.content),
      );
    if (sample.id === 'weekend' || sample.id === 'coffee') {
      const golf = find(/golf|ゴルフ|高尔夫/i),
        tennis = find(/tennis|テニス|网球/i);
      key = golf && tennis ? 'both' : golf ? 'golf' : tennis ? 'tennis' : 'neutral';
      if (golf) used.push(golf.id);
      if (tennis && tennis.id !== golf?.id) used.push(tennis.id);
    }
    if (sample.id === 'background') {
      const memory = find(/from china|grew up in china|来自中国|中国出身/i);
      if (memory) {
        key = 'chinese';
        used.push(memory.id);
      }
    }
    if (sample.id === 'work') {
      const memory = find(/designer|设计师|デザイナー/i);
      if (memory) {
        key = 'designer';
        used.push(memory.id);
      }
    }
    const phrase = phrases[key];
    const casual =
      input.settings.contextTones[input.settings.context] === 'casual' && phrase.casual;
    const pronunciation =
      input.settings.pronunciationMode === 'kana'
        ? casual || phrase.kana
        : casual
          ? phrase.ipa.replace(' desɯ', '')
          : phrase.ipa;
    return validateReply(
      {
        responseText: casual ? casual.replaceAll(' ', '') : phrase.text,
        pronunciation,
        meaning: phrase.meaning[input.settings.explanationLanguage],
        memoryIdsUsed: used,
      },
      input.settings.pronunciationMode,
      used,
    );
  }
  async pronounce(text: string, mode: PronunciationMode) {
    const phrase = Object.values(phrases).find(
      (p) => p.text === text || p.casual?.replaceAll(' ', '') === text,
    );
    if (!phrase) throw new Error('Connect a provider to convert custom replies.');
    const casual = phrase.casual?.replaceAll(' ', '') === text;
    return mode === 'kana'
      ? casual
        ? phrase.casual!
        : phrase.kana
      : casual
        ? phrase.ipa.replace(' desɯ', '')
        : phrase.ipa;
  }
  async extract(text: string, settings: Settings): Promise<MemoryInput[]> {
    const results: MemoryInput[] = [];
    const add = (
      key: string,
      content: string,
      category: MemoryInput['category'],
      scopes: MemoryInput['contexts'] = [],
    ) =>
      results.push({
        key,
        content,
        category,
        contexts: scopes,
        sensitivity: 'normal',
        confidence: 0.95,
      });
    // Intentionally conservative fixture parser; arbitrary-language extraction is cloud-only.
    for (const sentence of text.split(/[.!?。\n]+/)) {
      if (/\b(not|don't|do not|no longer|used to|my friend|my partner|he |she )\b/i.test(sentence))
        continue;
      if (/\bI(?: am|'m|’m) Chinese\b/i.test(sentence))
        add('background.nationality', 'I am Chinese.', 'background');
      if (/\bI(?: am|'m|’m) from China\b/i.test(sentence))
        add('background.origin', 'I am from China.', 'background');
      if (/\bI (?:like|love|enjoy|play)\b/i.test(sentence)) {
        if (/golf/i.test(sentence)) add('interest.golf', 'I enjoy golf.', 'interest');
        if (/tennis/i.test(sentence)) add('interest.tennis', 'I enjoy tennis.', 'interest');
      }
      if (/\bI (?:speak|know)\b/i.test(sentence)) {
        for (const language of [
          'English',
          'Mandarin',
          'Cantonese',
          'Japanese',
          'Spanish',
          'French',
          'German',
        ]) {
          if (new RegExp(`\\b${language}\\b`, 'i').test(sentence))
            add(`language.${language.toLowerCase()}`, `I speak ${language}.`, 'language');
        }
      }
      if (
        /\bI (?:work as|am|'m) (?:a |an )?(?:product |software |graphic )?designer/i.test(sentence)
      )
        add('work.role', 'I work as a designer.', 'work', ['professional']);
    }
    return [...new Map(results.map((m) => [m.key, m])).values()];
  }
}
