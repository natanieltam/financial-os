import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from '../../../shared/constants/finance'
import { moneyToCents, normalizeMoney } from '../../../shared/money'
import type { TransactionCreateInput } from '../../../shared/schemas/finance'
import type { TransactionIntent } from './ai.schemas'

/**
 * Business validation for the natural-language transaction parser (Phase 14).
 *
 * Pure and deterministic: intent + the user's real accounts/categories in,
 * either a ready-to-confirm transaction preview or a clarification question
 * out. AI output is untrusted (PRD §50) — this layer resolves, clamps and
 * verifies everything, and never invents missing financial data.
 */

export interface ParserAccount {
  id: string
  name: string
}

export interface ParserCategory {
  id: string
  name: string
  type: string
}

export interface ParserPreview {
  transaction: TransactionCreateInput
  /** Human-readable notes about deterministic resolutions (defaults, clamps). */
  notes: string[]
}

export interface ParserClarification {
  question: string
}

export type ParserResult = { preview: ParserPreview; clarification: null } | { preview: null; clarification: ParserClarification }

function todayIso(today: Date): string {
  return today.toISOString().slice(0, 10)
}

function normalizeAmount(value: string | number): string | null {
  try {
    // Numbers from the model arrive as JSON numbers; normalizeMoney handles both.
    const normalized = normalizeMoney(typeof value === 'number' ? String(value) : value)
    return moneyToCents(normalized) > 0n ? normalized : null
  } catch {
    return null
  }
}

function nameMatches(suggestion: string | null | undefined, name: string): boolean {
  if (!suggestion) return false
  const a = suggestion.trim().toLowerCase()
  const b = name.trim().toLowerCase()
  return a.length > 0 && (a === b || b.includes(a) || a.includes(b))
}

/** Finds the account the note refers to; null when ambiguous (never guessed). */
export function resolveAccount(
  suggestion: string | null | undefined,
  accounts: ParserAccount[],
): { accountId: string; resolvedBy: 'suggestion' | 'single' } | { clarification: string } | null {
  const active = accounts
  if (active.length === 0) {
    return { clarification: 'Belum ada akun. Buat akun dulu di halaman Accounts sebelum mencatat transaksi.' }
  }
  const matched = active.find((a) => nameMatches(suggestion, a.name))
  if (matched) return { accountId: matched.id, resolvedBy: 'suggestion' }
  if (active.length === 1) return { accountId: active[0]!.id, resolvedBy: 'single' }
  const names = active.map((a) => a.name).join(', ')
  return { clarification: `Pakai akun mana? Pilihan: ${names}.` }
}

/** Resolves a category suggestion; falls back to the system default — never invented. */
export function resolveCategory(
  suggestion: string | null | undefined,
  type: 'income' | 'expense',
  categories: ParserCategory[],
): { categoryId: string | null; note?: string } {
  const matched = categories.find((c) => c.type === type && nameMatches(suggestion, c.name))
  if (matched) return { categoryId: matched.id }
  const fallback = type === 'expense' ? DEFAULT_EXPENSE_CATEGORIES[0] : DEFAULT_INCOME_CATEGORIES[0]
  const fallbackMatch = categories.find((c) => c.type === type && c.name === fallback)
  return {
    categoryId: fallbackMatch?.id ?? null,
    note: suggestion
      ? `Kategori "${suggestion}" tidak ditemukan — pakai default "${fallbackMatch?.name ?? 'tanpa kategori'}" (bisa diubah sebelum konfirmasi).`
      : `Kategori tidak disebut — pakai default "${fallbackMatch?.name ?? 'tanpa kategori'}" (bisa diubah sebelum konfirmasi).`,
  }
}

/** Clamps the parsed date: invalid or future dates fall back to today, with a note. */
export function resolveDate(date: string | null | undefined, today: Date): { value: string; note?: string } {
  const t = todayIso(today)
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return { value: t, note: 'Tanggal tidak disebut — dicatat sebagai hari ini.' }
  }
  if (date > t) {
    return { value: t, note: 'Tanggal di masa depan tidak dicatat — diatur ke hari ini.' }
  }
  return { value: date }
}

/**
 * Turns a validated AI intent into a confirmed-ready transaction preview or a
 * clarification question. The AI must not invent missing required data —
 * anything ambiguous becomes a question (PRD Phase 14).
 */
export function resolvePreview(
  intent: TransactionIntent,
  opts: { accounts: ParserAccount[]; categories: ParserCategory[]; today: Date },
): ParserResult {
  if (intent.needsClarification && intent.clarificationQuestion) {
    return { preview: null, clarification: { question: intent.clarificationQuestion.slice(0, 300) } }
  }

  const amount = intent.amount === null || intent.amount === undefined ? null : normalizeAmount(intent.amount)
  if (!amount) {
    return { preview: null, clarification: { question: 'Jumlah transaksinya berapa?' } }
  }

  const type = intent.type === 'income' ? 'income' : 'expense'

  const account = resolveAccount(intent.account, opts.accounts)
  if (account && 'clarification' in account) {
    return { preview: null, clarification: { question: account.clarification } }
  }

  const notes: string[] = []
  if (account?.resolvedBy === 'single') notes.push('Akun ditentukan otomatis karena hanya ada satu akun aktif.')

  const category = resolveCategory(intent.category, type, opts.categories)
  if (category.note) notes.push(category.note)

  const date = resolveDate(intent.date, opts.today)
  if (date.note) notes.push(date.note)

  const transaction: TransactionCreateInput = {
    type,
    accountId: account!.accountId,
    categoryId: category.categoryId,
    amount,
    description: intent.description?.trim() || null,
    transactionDate: date.value,
  }

  return { preview: { transaction, notes }, clarification: null }
}
