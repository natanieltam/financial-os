import { and, asc, eq, lte } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { getDatabase } from '../../../db/client'
import { accounts, categories, recurringTransactions } from '../../../db/schema/index'
import type { RecurringCreateInput, RecurringUpdateInput } from '../../../shared/schemas/finance'
import type { RecurringFrequency } from '../../../shared/constants/finance'
import { apiErrors } from '../../utils/api'
import { audit } from '../../utils/audit'
import { getOwnedAccount } from '../accounts/service'
import { assertCategoryUsable } from '../categories/service'
import { addPeriods } from '../budgets/window'
import { createTransaction } from '../transactions/service'

/**
 * Recurring transactions (Phase 17, PRD §32). Generation is idempotent:
 * every occurrence carries the deterministic key `recurring:{id}:{date}`,
 * so retries can never create duplicates — TransactionService dedupes
 * against the (userId, idempotencyKey) unique index. All mutations go
 * through the existing TransactionService (never a second mutation path).
 * Date columns are DATE -> plain 'YYYY-MM-DD' strings end-to-end.
 */

export interface RecurringDTO {
  id: string
  type: 'income' | 'expense'
  accountId: string
  accountName: string
  categoryId: string | null
  categoryName: string | null
  amount: string
  description: string | null
  frequency: RecurringFrequency
  nextDueDate: string
  endDate: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

type RecurringRow = typeof recurringTransactions.$inferSelect

function toDTO(row: RecurringRow & { accountName: string; categoryName: string | null }): RecurringDTO {
  return {
    id: row.id,
    type: row.type as 'income' | 'expense',
    accountId: row.accountId,
    accountName: row.accountName,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    amount: row.amount,
    description: row.description,
    frequency: row.frequency as RecurringFrequency,
    nextDueDate: row.nextDueDate,
    endDate: row.endDate,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Pure: the due date of the n-th occurrence after `from` (PRD §32 frequency). */
export function occurrenceDate(from: Date, frequency: RecurringFrequency, n: number): Date {
  if (frequency === 'daily') {
    const d = new Date(from)
    d.setUTCDate(d.getUTCDate() + n)
    return d
  }
  return addPeriods(from, frequency as 'weekly' | 'monthly' | 'yearly', n)
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function dateOnly(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`)
}

async function getOwnedRecurring(userId: string, id: string): Promise<RecurringRow> {
  const rows = await getDatabase()
    .select()
    .from(recurringTransactions)
    .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, userId)))
    .limit(1)
  const row = rows[0]
  if (!row) throw apiErrors.notFound('Recurring transaction not found')
  return row
}

async function assertRecurringReferences(
  userId: string,
  input: { accountId?: string; categoryId?: string | null },
  type: 'income' | 'expense',
): Promise<void> {
  if (input.accountId) {
    const account = await getOwnedAccount(userId, input.accountId)
    if (account.status !== 'active') throw apiErrors.validation('Account is archived')
  }
  if (input.categoryId) {
    await assertCategoryUsable(userId, input.categoryId, type)
  }
}

export async function listRecurring(
  userId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<RecurringDTO[]> {
  const rows = await getDatabase()
    .select({ row: recurringTransactions, accountName: accounts.name, categoryName: categories.name })
    .from(recurringTransactions)
    .innerJoin(accounts, eq(recurringTransactions.accountId, accounts.id))
    .leftJoin(categories, eq(recurringTransactions.categoryId, categories.id))
    .where(
      opts.activeOnly
        ? and(eq(recurringTransactions.userId, userId), eq(recurringTransactions.isActive, true))
        : eq(recurringTransactions.userId, userId),
    )
    .orderBy(asc(recurringTransactions.nextDueDate))
  return rows.map((r: (typeof rows)[number]) =>
    toDTO({ ...r.row, accountName: r.accountName, categoryName: r.categoryName }),
  )
}

export async function createRecurring(userId: string, input: RecurringCreateInput): Promise<RecurringDTO> {
  await assertRecurringReferences(userId, { accountId: input.accountId, categoryId: input.categoryId }, input.type)
  const [row] = await getDatabase()
    .insert(recurringTransactions)
    .values({
      userId,
      type: input.type,
      accountId: input.accountId,
      categoryId: input.categoryId ?? null,
      amount: input.amount,
      description: input.description,
      frequency: input.frequency,
      nextDueDate: input.nextDueDate,
      endDate: input.endDate ?? null,
    })
    .returning()
  await audit(null, 'recurring_created', {
    userId,
    entityType: 'recurring_transaction',
    entityId: row!.id,
    metadata: { amount: input.amount },
  })
  const listed = await listRecurring(userId)
  return listed.find((r) => r.id === row!.id)!
}

export async function updateRecurring(
  userId: string,
  id: string,
  input: RecurringUpdateInput,
): Promise<RecurringDTO> {
  const existing = await getOwnedRecurring(userId, id)
  await assertRecurringReferences(
    userId,
    { accountId: input.accountId, categoryId: input.categoryId },
    existing.type as 'income' | 'expense',
  )
  await getDatabase()
    .update(recurringTransactions)
    .set({
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.amount ? { amount: input.amount } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(input.frequency ? { frequency: input.frequency } : {}),
      ...(input.nextDueDate ? { nextDueDate: input.nextDueDate } : {}),
      ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    })
    .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, userId)))
  await audit(null, 'recurring_updated', { userId, entityType: 'recurring_transaction', entityId: id })
  const listed = await listRecurring(userId)
  return listed.find((r) => r.id === id)!
}

/** Deactivation only — the template row is kept (never destroys history). */
export async function deactivateRecurring(userId: string, id: string): Promise<RecurringDTO> {
  return updateRecurring(userId, id, { isActive: false })
}

export interface ProcessRecurringResult {
  created: number
  skipped: number
  processed: number
  items: Array<{ recurringId: string; date: string; status: 'created' | 'duplicate' }>
}

const MAX_OCCURRENCES_PER_RUN = 90 // safety cap against runaway catch-up

/**
 * Creates transactions for every due occurrence up to `asOf` (inclusive) and
 * advances nextDueDate. Idempotent: re-running creates nothing new — the
 * deterministic occurrence key dedupes against TransactionService (PRD §32).
 */
export async function processRecurring(
  event: H3Event,
  userId: string,
  asOf: Date = new Date(),
): Promise<ProcessRecurringResult> {
  const today = isoDay(asOf)
  const due = await getDatabase()
    .select()
    .from(recurringTransactions)
    .where(
      and(
        eq(recurringTransactions.userId, userId),
        eq(recurringTransactions.isActive, true),
        lte(recurringTransactions.nextDueDate, today),
      ),
    )
    .orderBy(asc(recurringTransactions.nextDueDate))

  const result: ProcessRecurringResult = { created: 0, skipped: 0, processed: 0, items: [] }

  for (const template of due) {
    let cursor = template.nextDueDate // DATE column: plain 'YYYY-MM-DD' string
    let count = 0
    while (cursor <= today && count < MAX_OCCURRENCES_PER_RUN) {
      if (template.endDate && cursor > template.endDate) break
      const created = await createTransaction(event, userId, {
        type: template.type as 'income' | 'expense',
        accountId: template.accountId,
        categoryId: template.categoryId,
        amount: template.amount,
        description: template.description,
        transactionDate: cursor,
        idempotencyKey: `recurring:${template.id}:${cursor}`,
      })
      if (created.deduplicated) {
        result.skipped++
        result.items.push({ recurringId: template.id, date: cursor, status: 'duplicate' })
      } else {
        result.created++
        result.items.push({ recurringId: template.id, date: cursor, status: 'created' })
      }
      count++
      cursor = isoDay(occurrenceDate(dateOnly(cursor), template.frequency as RecurringFrequency, 1))
    }

    if (template.endDate && cursor > template.endDate) {
      await getDatabase()
        .update(recurringTransactions)
        .set({ nextDueDate: cursor, isActive: false })
        .where(eq(recurringTransactions.id, template.id))
    } else {
      await getDatabase()
        .update(recurringTransactions)
        .set({ nextDueDate: cursor })
        .where(eq(recurringTransactions.id, template.id))
    }
    result.processed++
  }

  if (result.processed > 0) {
    await audit(null, 'recurring_processed', {
      userId,
      entityType: 'recurring_transaction',
      metadata: { created: result.created, skipped: result.skipped },
    })
  }
  return result
}
