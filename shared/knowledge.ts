import { z } from 'zod';

export const KnowledgeInputSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  text: z.string().trim().min(1).max(2000),
});
export type KnowledgeInput = z.infer<typeof KnowledgeInputSchema>;
export const TopicsSchema = z.object({
  topics: z
    .array(
      z.object({
        keyword: z.string().trim().min(1).max(100),
        context: z.string().trim().min(1).max(400),
        deeper: z.boolean(),
      }),
    )
    .max(4),
});
export type KnowledgeTopic = z.infer<typeof TopicsSchema>['topics'][number];
export const GroundedKnowledgeSchema = z.object({
  cards: z
    .array(
      z.object({
        keyword: z.string().trim().min(1).max(100),
        explanation: z.string().trim().min(1).max(900),
        background: z.string().trim().max(1800).nullable(),
        related: z.array(z.string().trim().min(1).max(200)).max(4),
        sourceIds: z.array(z.number().int().nonnegative()).min(1).max(8),
        flag: z
          .object({
            claim: z.string().trim().min(1).max(600),
            explanation: z.string().trim().min(1).max(900),
            level: z.enum(['!', '!!', '!!!']),
            sourceIds: z.array(z.number().int().nonnegative()).min(1).max(8),
          })
          .nullable(),
      }),
    )
    .max(4),
  questions: z.array(z.string().trim().min(1).max(300)).length(3),
});
export interface KnowledgeSource {
  id: number;
  title: string;
  url: string;
}
export type KnowledgeCard = Omit<
  z.infer<typeof GroundedKnowledgeSchema>['cards'][number],
  'sourceIds' | 'flag'
> & {
  sources: KnowledgeSource[];
  flag:
    | (Omit<
        NonNullable<z.infer<typeof GroundedKnowledgeSchema>['cards'][number]['flag']>,
        'sourceIds'
      > & { sources: KnowledgeSource[] })
    | null;
};
export interface KnowledgeEntry extends KnowledgeInput {
  createdAt: string;
  cards: KnowledgeCard[];
  questions: string[];
}
export type KnowledgeEvent =
  | { type: 'keywords'; topics: KnowledgeTopic[] }
  | { type: 'complete'; entry: KnowledgeEntry }
  | { type: 'error'; message: string };
export interface KnowledgeStatus {
  provider?: 'local' | 'openai';
  configured: boolean;
  message: string;
}
export const flagLabels = {
  '!': 'Possible inaccuracy — evidence needs qualification',
  '!!': 'Likely inaccurate — direct contradicting evidence',
  '!!!': 'Strongly contradicted — corroborated evidence',
} as const;
