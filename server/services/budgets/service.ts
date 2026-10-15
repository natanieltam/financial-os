import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { getDatabase } from '../../../db/client'
import { budgetItems, budgets, categories, transactions } from '../../../db/schema/index'
import type { BudgetCreateInput, BudgetUpdateInput } from '../../../shared/schemas/finance'
import { budgetItemStatus, budgetPercent, computeBudgetWindow } from './window'
import { assertCategoryUsable } from '../categories/service'
import { apiErrors } from '../../utils/api'
import { audit } from '../../utils/audit'

/**
 * Budget system (PRD §29): CRUD + category allocations. Actual spending always
 * comes from live transactions (§30) — budgets never duplicate financial truth.
 */

export interface BudgetItemDTO {
  id: string
  categoryId: string
  categoryName: string
  categoryColor: string | null
  amount: string
  spent: string
  remaining: string
  percent: number
  status: 'healthy' | 'warning' | 'exceeded'
}

export interface BudgetDTO {
  id: string
  name: string
  period: string
  startDate: string
  endDate: string | null
  isArchived: boolean
  window: { start: string; end: string }
  items: BudgetItemDTO[]
  totals: {
    budgeted: string
    spent: string
    remaining: string
    percent: number
    status: 'healthy' | 'warning' | 'exceeded'
  }
  createdAt: string
  updatedAt: string
}

type BudgetRow = typeof budgets.$inferSelect

const CENTS_DIV = (cents: bigint): string => {
  const negative = cents < 0n
  const abs = negative ? -cents : cents
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`
}

function toCents(money: string): bigint {
  const negative = money.startsWith('-')
  const body = negative ? money.slice(1) : money
  const [i = '0', f = '0'] = body.split('.')
  const cents = BigInt(i) * 100n + BigInt(f.padEnd(2, '0').slice(0, 2))
  return negative ? -cents : cents
}

async function getOwnedBudget(userId: string, budgetId: string): Promise<BudgetRow> {
  const rows = await getDatabase()
    .select()
    .from(budgets)
    .where(and(eq(budgets.id, budgetId), eq(budgets.userId, userId)))
    .limit(1)
  const row = rows[0]
  if (!row) throw apiErrors.notFound('Budget not found')
  return row
}

export async function getBudget(userId: string, budgetId: string): Promise<BudgetDTO> {
  const row = await getOwnedBudget(userId, budgetId)
  return serializeBudget(userId, row, new Date())
}

/** Actual spend per category inside the budget's window (PRD §30). */
async function spentByCategory(
  userId: string,
  windowStart: Date,
  windowEnd: Date,
  categoryIds: string[],
): Promise<Map<string, bigint>> {
  if (categoryIds.length === 0) return new Map()
  const rows = await getDatabase()
    .select({
      categoryId: transactions.categoryId,
      total: sql<string>`coalesce(sum(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.type, 'expense'),
        isNull(transactions.deletedAt),
        inArray(transactions.categoryId, categoryIds),
        sql`${transactions.transactionDate} >= ${windowStart}`,
        sql`${transactions.transactionDate} < ${windowEnd}`,
      ),
    )
    .groupBy(transactions.categoryId)
  const map = new Map<string, bigint>()
  for (const row of rows) {
    if (row.categoryId) map.set(row.categoryId, toCents(row.total))
  }
  return map
}

async function serializeBudget(
  userId: string,
  row: BudgetRow,
  asOf: Date,
): Promise<BudgetDTO> {
  const window = computeBudgetWindow(
    row.period as Parameters<typeof computeBudgetWindow>[0],
    row.startDate,
    row.endDate,
    asOf,
  )
  const items = await getDatabase()
    .select({
      id: budgetItems.id,
      categoryId: budgetItems.categoryId,
      amount: budgetItems.amount,
      categoryName: categories.name,
      categoryColor: categories.color,
    })
    .from(budgetItems)
    .innerJoin(categories, eq(budgetItems.categoryId, categories.id))
    .where(eq(budgetItems.budgetId, row.id))
    .orderBy(categories.name)
  const spent = await spentByCategory(
    userId,
    window.start,
    window.end,
    items.map((i) => i.categoryId),
  )

  let totalBudgeted = 0n
  let totalSpent = 0n
  const itemDtos: BudgetItemDTO[] = items.map((item) => {
    const amountCents = toCents(item.amount)
    const spentCents = spent.get(item.categoryId) ?? 0n
    totalBudgeted += amountCents
    totalSpent += spentCents
    return {
      id: item.id,
      categoryId: item.categoryId,
      categoryName: item.categoryName,
      categoryColor: item.categoryColor,
      amount: item.amount,
      spent: CENTS_DIV(spentCents),
      remaining: CENTS_DIV(amountCents - spentCents),
      percent: budgetPercent(spentCents, amountCents),
      status: budgetItemStatus(spentCents, amountCents),
    }
  })

  return {
    id: row.id,
    name: row.name,
    period: row.period,
    startDate: row.startDate,
    endDate: row.endDate,
    isArchived: row.isArchived,
    window: { start: window.start.toISOString(), end: window.end.toISOString() },
    items: itemDtos,
    totals: {
      budgeted: CENTS_DIV(totalBudgeted),
      spent: CENTS_DIV(totalSpent),
      remaining: CENTS_DIV(totalBudgeted - totalSpent),
      percent: budgetPercent(totalSpent, totalBudgeted),
      status: budgetItemStatus(totalSpent, totalBudgeted),
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listBudgets(
  userId: string,
  opts: { includeArchived?: boolean; asOf?: Date } = {},
): Promise<BudgetDTO[]> {
  const filters = [eq(budgets.userId, userId)]
  if (!opts.includeArchived) filters.push(eq(budgets.isArchived, false))
  const rows = await getDatabase()
    .select()
    .from(budgets)
    .where(and(...filters))
    .orderBy(desc(budgets.createdAt))
  const asOf = opts.asOf ?? new Date()
  const result: BudgetDTO[] = []
  for (const row of rows) result.push(await serializeBudget(userId, row, asOf))
  return result
}

async function assertBudgetNameFree(userId: string, name: string, excludeId?: string) {
  const rows = await getDatabase()
    .select({ id: budgets.id })
    .from(budgets)
    .where(
      and(
        eq(budgets.userId, userId),
        eq(budgets.isArchived, false),
        sql`lower(${budgets.name}) = lower(${name})`,
        excludeId ? sql`${budgets.id} <> ${excludeId}` : sql`true`,
      ),
    )
    .limit(1)
  if (rows.length > 0) throw apiErrors.conflict('An active budget with this name already exists')
}

export async function createBudget(
  event: H3Event,
  userId: string,
  input: BudgetCreateInput,
): Promise<BudgetDTO> {
  await assertBudgetNameFree(userId, input.name)
  for (const item of input.items) {
    await assertCategoryUsable(userId, item.categoryId, 'expense')
  }
  const db = getDatabase()
  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(budgets)
      .values({
        userId,
        name: input.name,
        period: input.period,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
      })
      .returning()
    if (!row) throw apiErrors.internal()
    await tx.insert(budgetItems).values(
      input.items.map((item) => ({
        budgetId: row.id,
        userId,
        categoryId: item.categoryId,
        amount: item.amount,
      })),
    )
    return row
  })
  await audit(event, 'budget_created', {
    userId,
    entityType: 'budget',
    entityId: created.id,
    metadata: { period: input.period, items: input.items.length },
  })
  return serializeBudget(userId, created, new Date())
}

export async function updateBudget(
  event: H3Event,
  userId: string,
  budgetId: string,
  input: BudgetUpdateInput,
): Promise<BudgetDTO> {
  const existing = await getOwnedBudget(userId, budgetId)
  if (input.name !== undefined && input.name !== existing.name) {
    await assertBudgetNameFree(userId, input.name, existing.id)
  }
  if (input.items) {
    for (const item of input.items) {
      await assertCategoryUsable(userId, item.categoryId, 'expense')
    }
  }
  const db = getDatabase()
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(budgets)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.period !== undefined ? { period: input.period } : {}),
        ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
        ...(input.endDate !== undefined ? { endDate: input.endDate ?? null } : {}),
        ...(input.isArchived !== undefined ? { isArchived: input.isArchived } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(budgets.id, existing.id), eq(budgets.userId, userId)))
      .returning()
    if (!row) throw apiErrors.notFound('Budget not found')
    if (input.items) {
      // Full replacement keeps budget ↔ items consistent (PRD §29).
      await tx.delete(budgetItems).where(eq(budgetItems.budgetId, row.id))
      await tx.insert(budgetItems).values(
        input.items.map((item) => ({
          budgetId: row.id,
          userId,
          categoryId: item.categoryId,
          amount: item.amount,
        })),
      )
    }
    return row
  })
  await audit(event, 'budget_updated', {
    userId,
    entityType: 'budget',
    entityId: updated.id,
    metadata: { fields: Object.keys(input) },
  })
  return serializeBudget(userId, updated, new Date())
}

/** "Delete" = archive (PRD §29): budget history and items stay intact. */
export async function archiveBudget(
  event: H3Event,
  userId: string,
  budgetId: string,
): Promise<BudgetDTO> {
  const existing = await getOwnedBudget(userId, budgetId)
  const updated = await getDatabase()
    .update(budgets)
    .set({ isArchived: true, updatedAt: new Date() })
    .where(and(eq(budgets.id, existing.id), eq(budgets.userId, userId)))
    .returning()
  const row = updated[0] ?? existing
  await audit(event, 'budget_archived', {
    userId,
    entityType: 'budget',
    entityId: row.id,
  })
  return serializeBudget(userId, row, new Date())
}
