import type { H3Event } from 'h3'
import { listAccounts } from '../accounts/service'
import { listCategories } from '../categories/service'
import { parseIntentFromResponse, requireAiProvider, runChat } from './ai.service'
import { resolvePreview, type ParserClarification, type ParserPreview } from './parser'

/**
 * Natural-language transaction parsing orchestration (Phase 14).
 *
 * AI output is NEVER a mutation: this service produces either a preview the
 * user can edit and explicitly confirm (which then goes through the standard
 * POST /api/transactions -> TransactionService path), or a clarification
 * question when required information is missing (PRD Phase 14).
 */

const PARSER_SYSTEM_PROMPT = `You are a transaction parser for Financial OS (Indonesian + English input).
Extract the transaction intent from the note and answer with ONLY a JSON object:
{
  "type": "income" | "expense",
  "amount": "<decimal string, no separators>",
  "description": "<short description or null>",
  "category": "<category name hint or null>",
  "account": "<account name hint or null>",
  "date": "YYYY-MM-DD or null",
  "confidence": "high" | "medium" | "low",
  "needsClarification": true|false,
  "clarificationQuestion": "<question in user's language when clarification is needed, else null>"
}
Rules:
- NEVER invent required information. If the amount is missing or ambiguous,
  - set needsClarification=true with a concrete question (e.g. "Jumlah transaksinya berapa?") and amount to null — never invent missing values.
- If multiple accounts or categories could apply, set needsClarification=true.
- Do not guess dates: use null unless the note clearly states a day.
- Amount is always a plain positive decimal string (e.g. "25000" for 25 ribu).`

export interface ParseNoteResult {
  preview: ParserPreview | null
  clarification: ParserClarification | null
}

export async function parseTransactionNote(event: H3Event, userId: string, text: string): Promise<ParseNoteResult> {
  const provider = requireAiProvider()

  const response = await runChat(provider, {
    temperature: 0,
    maxTokens: 500,
    messages: [
      { role: 'system', content: PARSER_SYSTEM_PROMPT },
      { role: 'user', content: text },
    ],
  })

  const intent = parseIntentFromResponse(response.content)

  const [accounts, categories] = await Promise.all([
    listAccounts(userId),
    listCategories(userId),
  ])

  return resolvePreview(intent, {
    accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
    categories: categories.map((c) => ({ id: c.id, name: c.name, type: c.type })),
    today: new Date(),
  })
}
