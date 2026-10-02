import { z } from 'zod';

export const contexts = ['social', 'professional', 'dating'] as const;
export const tones = ['regular', 'casual', 'professional'] as const;
export const languages = {
  en: 'English',
  zh: '中文',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
} as const;
export type Context = (typeof contexts)[number];
export type Tone = (typeof tones)[number];
export type Language = keyof typeof languages;
export type PronunciationMode = 'kana' | 'ipa';
export type Speaker = 'partner' | 'user';

export const SettingsSchema = z.object({
  context: z.enum(contexts).default('social'),
  contextTones: z
    .object({ social: z.enum(tones), professional: z.enum(tones), dating: z.enum(tones) })
    .default({ social: 'regular', professional: 'professional', dating: 'casual' }),
  explanationLanguage: z.enum(['en', 'zh', 'es', 'fr', 'de']).default('en'),
  pronunciationMode: z.enum(['kana', 'ipa']).default('kana'),
  spokenLanguages: z.string().max(200).default('English'),
  silenceMs: z.number().int().min(400).max(2000).default(850),
  vadThreshold: z.number().min(0.005).max(0.1).default(0.018),
  autoLearn: z.boolean().default(true),
  onboarded: z.boolean().default(false),
});
export type Settings = z.infer<typeof SettingsSchema>;
export const defaultSettings = SettingsSchema.parse({});

export const MemoryInputSchema = z.object({
  content: z.string().trim().min(2).max(300),
  key: z.string().trim().min(1).max(100),
  category: z.enum(['background', 'language', 'interest', 'work', 'preference', 'boundary']),
  contexts: z.array(z.enum(contexts)).max(3),
  sensitivity: z.enum(['normal', 'sensitive']),
  confidence: z.number().min(0).max(1),
});
export type MemoryInput = z.infer<typeof MemoryInputSchema>;
export interface Memory extends MemoryInput {
  id: string;
  source: 'onboarding' | 'conversation' | 'manual';
  status: 'active' | 'pending';
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}
export const ReplySchema = z.object({
  responseText: z.string().trim().min(1).max(100),
  pronunciation: z.string().trim().min(1).max(600),
  meaning: z.string().trim().min(1).max(500),
  memoryIdsUsed: z.array(z.string()).max(8),
});
export type Reply = z.infer<typeof ReplySchema> & {
  targetLanguage: 'ja';
  pronunciationMode: PronunciationMode;
};
export interface Metrics {
  translationMs: number;
  generationMs: number;
  totalMs: number;
}
export interface TurnResult {
  id: string;
  speaker: Speaker;
  transcript: string;
  translation: string;
  reply: Reply | null;
  metrics: Metrics;
}
export interface Bootstrap {
  settings: Settings;
  memories: Memory[];
  provider: 'mock' | 'openai' | 'groq' | 'local';
  liveAvailable: boolean;
  configurationError: string | null;
  demoEnabled: boolean;
  connection: ConnectionStatus;
  trtc: TrtcInfo;
}
export interface ServiceCheck {
  status: 'unchecked' | 'checking' | 'ready' | 'error';
  message: string;
  latencyMs: number | null;
}
export interface ConnectionStatus {
  configured: boolean;
  provider: 'openai' | 'groq' | 'mock' | 'local';
  checkedAt: string | null;
  models: { text: string; memory: string; speech: string };
  text: ServiceCheck;
  memory: ServiceCheck;
  speech: ServiceCheck;
}
/** A single target-language result returned alongside a TRTC transcript segment. */
export interface TranslationText {
  language: string;
  text: string;
}
/** Server-minted, short-lived credentials the browser needs to join a TRTC room. */
export interface TrtcCredentials {
  sdkAppId: number;
  userId: string;
  userSig: string;
  roomId: number;
  sourceLanguage: string;
  targetLanguage: string;
}
export interface TrtcInfo {
  configured: boolean;
  sourceLanguage: string;
  targetLanguage: string;
}

export const TurnSchema = z.object({
  id: z.string().uuid(),
  text: z.string().trim().min(1).max(2000),
  speaker: z.enum(['partner', 'user']),
  demo: z.boolean().default(false),
  // Final translation from the active speech provider, not a partial subtitle.
  translated: z
    .object({
      text: z.string().trim().min(1).max(2000),
      language: z.enum(['en', 'zh', 'es', 'fr', 'de']),
    })
    .optional(),
  recent: z
    .array(z.object({ speaker: z.enum(['partner', 'user']), text: z.string().max(2000) }))
    .max(4)
    .default([]),
});
export type TurnInput = z.infer<typeof TurnSchema>;

export const samples = [
  {
    id: 'weekend',
    title: 'Weekend plans',
    context: 'social' as Context,
    text: '週末は何をしていますか？',
    meaning: 'What do you usually do on weekends?',
  },
  {
    id: 'work',
    title: 'Meeting someone new',
    context: 'professional' as Context,
    text: 'お仕事は何をされていますか？',
    meaning: 'What do you do for work?',
  },
  {
    id: 'coffee',
    title: 'Getting to know you',
    context: 'dating' as Context,
    text: '休みの日は何をするのが好きですか？',
    meaning: 'What do you like doing on your days off?',
  },
  {
    id: 'background',
    title: 'Where you’re from',
    context: 'social' as Context,
    text: 'ご出身はどちらですか？',
    meaning: 'Where are you from?',
  },
] as const;
