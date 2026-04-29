import { z } from 'zod'

export const VARIANTS = [
  {
    id: 'minimal',
    label: 'Minimalist',
    sigil: 'M',
    temperature: 0.3,
    systemSuffix:
      'Bias toward minimalism, restraint, generous whitespace, and visual silence. Strip ornamentation. A monochrome palette with one careful accent. Prefer simple typography hierarchies.',
  },
  {
    id: 'rich',
    label: 'Editorial',
    sigil: 'E',
    temperature: 0.7,
    systemSuffix:
      'Bias toward editorial density: considered typography pairings, layered detail, evocative copy, structured sections, and a magazine-grade rhythm. Use a refined accent color and tasteful texture.',
  },
  {
    id: 'playful',
    label: 'Vivid',
    sigil: 'V',
    temperature: 1.0,
    systemSuffix:
      'Bias toward vivid personality: bold color, unexpected layout, decorative motion, and friendly micro-copy. Make the page feel alive without becoming chaotic.',
  },
] as const

export type VariantId = (typeof VARIANTS)[number]['id']

export const verdictSchema = z.object({
  winnerId: z
    .enum(['minimal', 'rich', 'playful'])
    .describe('Id of the candidate that best fulfils the brief.'),
  reasoning: z
    .string()
    .describe('One short sentence explaining the verdict in editorial voice.'),
  scores: z
    .array(
      z.object({
        id: z.enum(['minimal', 'rich', 'playful']),
        clarity: z.number().min(0).max(1),
        fit: z.number().min(0).max(1),
        polish: z.number().min(0).max(1),
        composite: z.number().min(0).max(1),
        comment: z
          .string()
          .describe('One short critique of this candidate, ~10 words.'),
      }),
    )
    .describe('One scoring entry per candidate.'),
})

export type Verdict = z.infer<typeof verdictSchema>

export type TournamentEvent =
  | { type: 'candidate_start'; id: VariantId; label: string; sigil: string }
  | { type: 'candidate_chunk'; id: VariantId; fragment: any }
  | { type: 'candidate_done'; id: VariantId; fragment: any }
  | { type: 'candidate_error'; id: VariantId; error: string }
  | { type: 'verdict'; verdict: Verdict }
  | { type: 'tournament_done' }
