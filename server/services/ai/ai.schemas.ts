import { z } from 'zod'

/**
 * Zod contracts for AI output (PRD §40, §50). Every AI response is untrusted
 * input: it must pass these schemas before the service layer acts on it.
 */

/** Transaction extraction intent produced by the natural-language parser (Phase 14). */
export const transactionIntentSchema = z.object({
  type: z.enum(['income', 'expense']),
  /** Decimal string or plain number from the model; null only when the model asks for clarification (PRD: never invent required information). */
  amount: z.union([z.string(), z.number(), z.null()]),
  description: z.string().max(200).nullish(),
  /** Category name suggestion — resolved against the user's real categories. */
  category: z.string().max(80).nullish(),
  /** Account name suggestion — resolved against the user's real accounts. */
  account: z.string().max(120).nullish(),
  /** YYYY-MM-DD when the note implies a specific day; otherwise null. */
  date: z.string().max(10).nullish(),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
  /** True when the model cannot infer required information — it must NOT guess. */
  needsClarification: z.boolean().optional(),
  clarificationQuestion: z.string().max(300).nullish(),
})
  .superRefine((value, ctx) => {
    if (value.needsClarification !== true && value.amount == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message: 'amount is required unless needsClarification is true' })
    }
    if (value.needsClarification === true && !value.clarificationQuestion?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['clarificationQuestion'], message: 'clarificationQuestion is required when needsClarification is true' })
    }
  })
export type TransactionIntent = z.infer<typeof transactionIntentSchema>

/** Structured answer contract for Ask Your Finances (Phase 15). */
export const askAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(4000),
})
export type AskAnswer = z.infer<typeof askAnswerSchema>

/**
 * Extracts the first JSON object from model output. Tolerates markdown fences
 * and prose around the object, but returns null for anything unparseable —
 * callers must treat null as a malformed AI response (never guess values).
 */
export function extractJsonObject(text: string): unknown | null {
  if (typeof text !== 'string') return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced?.[1] ?? text).trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  const slice = candidate.slice(start, end + 1)
  try {
    return JSON.parse(slice)
  } catch {
    return null
  }
}
