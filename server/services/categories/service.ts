import { and, eq, isNull, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { getDatabase } from '../../../db/client'
import { budgetItems, categories, transactions } from '../../../db/schema/index'
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  systemCategoryIds,
} from '../../../shared/constants/finance'
import type {
  CategoryCreateInput,
  CategoryUpdateInput,
} from '../../../shared/schemas/finance'
import { apiErrors } from '../../utils/api'
import { audit } from '../../utils/audit'

export interface CategoryDTO {
  id: string
  name: string
  type: string
  color: string | null
  icon: string | null
  sortOrder: number
  isSystem: boolean
  isArchived: boolean
  parentId: string | null
  transactionCount: number
}

type CategoryRow = typeof categories.$inferSelect

function toDTO(row: CategoryRow, transactionCount = 0): CategoryDTO {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    color: row.color,
    icon: row.icon,
    sortOrder: row.sortOrder,
    isSystem: row.isSystem,
    isArchived: row.isArchived,
    parentId: row.parentId,
    transactionCount,
  }
}

/**
 * Seed PRD §18 default categories as GLOBAL system rows (user_id NULL).
 * Idempotent: fixed ids + ON CONFLICT DO NOTHING (PRD §95).
 */
export async function ensureSystemCategories(): Promise<void> {
  const db = getDatabase()
  const existing = await db
    .select({ id: categories.id })
    .from(categories)
    .where(sql`${categories.isSystem} = true`)
    .limit(1)
  if (existing.length > 0) return
  const ids = systemCategoryIds()
  const values = [
    ...DEFAULT_EXPENSE_CATEGORIES.map((name, i) => ({
      id: ids[`expense:${name}`],
      userId: null as string | null,
      name,
      type: 'expense' as const,
      isSystem: true,
      sortOrder: i,
    })),
    ...DEFAULT_INCOME_CATEGORIES.map((name, i) => ({
      id: ids[`income:${name}`],
      userId: null as string | null,
      name,
      type: 'income' as const,
      isSystem: true,
      sortOrder: i,
    })),
  ]
  await db.insert(categories).values(values).onConflictDoNothing()
}

const categoryCountSql = sql`(select count(*)::int from ${transactions}
  where ${transactions.categoryId} = ${categories.id}
    and ${transactions.deletedAt} is null)`

/** System categories + the authenticated user's own categories (PRD §18). */
export async function listCategories(
  userId: string,
  opts: { type?: string; includeArchived?: boolean } = {},
): Promise<CategoryDTO[]> {
  await ensureSystemCategories()
  const filters = [sql`(${categories.userId} is null or ${categories.userId} = ${userId})`]
  if (opts.type) filters.push(eq(categories.type, opts.type as CategoryRow['type']))
  if (!opts.includeArchived) filters.push(eq(categories.isArchived, false))
  const rows = await getDatabase()
    .select({ row: categories, count: categoryCountSql })
    .from(categories)
    .where(and(...filters))
    .orderBy(categories.type, categories.sortOrder, categories.name)
  return rows.map((r) => toDTO(r.row, r.count as number | undefined))
}

async function getOwnedCategory(userId: string, categoryId: string): Promise<CategoryRow> {
  const rows = await getDatabase()
    .select()
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .limit(1)
  const row = rows[0]
  if (!row) throw apiErrors.notFound('Category not found')
  return row
}

export async function createCategory(
  event: H3Event,
  userId: string,
  input: CategoryCreateInput,
): Promise<CategoryDTO> {
  const db = getDatabase()
  const aggRows = await db
    .select({ maxOrder: sql<number>`coalesce(max(${categories.sortOrder}), -1)` })
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.type, input.type)))
    .limit(1)
  const maxOrder = aggRows[0]?.maxOrder ?? -1
  const inserted = await db
    .insert(categories)
    .values({
      userId,
      name: input.name,
      type: input.type,
      color: input.color ?? null,
      icon: input.icon ?? null,
      sortOrder: (maxOrder ?? -1) + 1,
    })
    .returning()
  const row = inserted[0]
  if (!row) throw apiErrors.internal()
  await audit(event, 'category_created', {
    userId,
    entityType: 'category',
    entityId: row.id,
    metadata: { type: row.type },
  })
  return toDTO(row, 0)
}

export async function updateCategory(
  event: H3Event,
  userId: string,
  categoryId: string,
  input: CategoryUpdateInput,
): Promise<CategoryDTO> {
  const existing = await getOwnedCategory(userId, categoryId)
  const updated = await getDatabase()
    .update(categories)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.isArchived !== undefined ? { isArchived: input.isArchived } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(categories.id, existing.id), eq(categories.userId, userId)))
    .returning()
  const row = updated[0]
  if (!row) throw apiErrors.notFound('Category not found')
  await audit(event, 'category_updated', {
    userId,
    entityType: 'category',
    entityId: row.id,
    metadata: { fields: Object.keys(input) },
  })
  return toDTO(row, 0)
}

/**
 * Safe deletion (PRD §18): a category referenced by transactions or budget
 * items is archived instead of deleted, so historical records stay intact
 * (transactions keep their FK; budget_items are protected by RESTRICT).
 */
export async function deleteCategory(
  event: H3Event,
  userId: string,
  categoryId: string,
): Promise<{ category: CategoryDTO; archived: boolean }> {
  const db = getDatabase()
  const existing = await getOwnedCategory(userId, categoryId)
  const referencedTx = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.categoryId, existing.id), isNull(transactions.deletedAt)))
    .limit(1)
  const referencedBudget = await db
    .select({ id: budgetItems.id })
    .from(budgetItems)
    .where(eq(budgetItems.categoryId, existing.id))
    .limit(1)
  if (referencedTx.length > 0 || referencedBudget.length > 0) {
    const archived = await db
      .update(categories)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(and(eq(categories.id, existing.id), eq(categories.userId, userId)))
      .returning()
    await audit(event, 'category_archived', {
      userId,
      entityType: 'category',
      entityId: existing.id,
      metadata: { referencedByTransactions: referencedTx.length > 0 },
    })
    return { category: toDTO(archived[0] ?? existing, referencedTx.length), archived: true }
  }
  await db.delete(categories).where(and(eq(categories.id, existing.id), eq(categories.userId, userId)))
  await audit(event, 'category_deleted', {
    userId,
    entityType: 'category',
    entityId: existing.id,
  })
  return { category: toDTO(existing, 0), archived: false }
}

/** Validate that a category id is usable by this user for a given flow type. */
export async function assertCategoryUsable(
  userId: string,
  categoryId: string,
  flowType: 'income' | 'expense',
): Promise<void> {
  const rows = await getDatabase()
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.id, categoryId),
        eq(categories.type, flowType),
        sql`(${categories.userId} is null or ${categories.userId} = ${userId})`,
        eq(categories.isArchived, false),
      ),
    )
    .limit(1)
  if (rows.length === 0) {
    throw apiErrors.validation('Category not found for this transaction type')
  }
}
