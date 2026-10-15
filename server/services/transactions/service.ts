import { and, desc, eq, gte, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { H3Event } from 'h3'
import { getDatabase } from '../../../db/client'
import { accounts, categories, transactions } from '../../../db/schema/index'
import type {
  TransactionCreateInput,
  TransactionListQuery,
  TransactionUpdateInput,
} from '../../../shared/schemas/finance'
import { subMoney } from '../../../shared/money'
import { getOwnedAccount } from '../accounts/service'
import { assertCategoryUsable } from '../categories/service'
import { isUniqueViolation } from '../../repositories/finance'
import { apiErrors } from '../../utils/api'
import { audit } from '../../utils/audit'

/**
 * Centralized TransactionService (PRD §20).
 * Every financial mutation flows through here: server-side validation,
 * ownership authorization, atomic transfers, precise NUMERIC amounts.
 */

export interface TransactionDTO {
  id: string
  type: string
  accountId: string
  accountName: string
  toAccountId: string | null
  toAccountName: string | null
  categoryId: string | null
  categoryName: string | null
  categoryColor: string | null
  amount: string
  description: string | null
  merchant: string | null
  notes: string | null
  transactionDate: string
  transferGroupId: string | null
  idempotencyKey: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface CreateResult {
  transaction: TransactionDTO
  deduplicated: boolean
}

interface RowShape {
  id: string
  userId: string
  accountId: string
  transferGroupId: string | null
  transferDirection: string | null
  idempotencyKey: string | null
  categoryId: string | null
  type: string
  amount: string
  description: string | null
  merchant: string | null
  notes: string | null
  transactionDate: Date
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  accountName: string
  toAccountId: string | null
  toAccountName: string | null
  categoryName: string | null
  categoryColor: string | null
}

function toDTO(row: RowShape): TransactionDTO {
  return {
    id: row.id,
    type: row.type,
    accountId: row.accountId,
    accountName: row.accountName,
    toAccountId: row.toAccountId,
    toAccountName: row.toAccountName,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    categoryColor: row.categoryColor,
    amount: row.amount,
    description: row.description,
    merchant: row.merchant,
    notes: row.notes,
    transactionDate: row.transactionDate.toISOString(),
    transferGroupId: row.transferGroupId ?? row.transferGroupId,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  }
}

/** Date-only values are stored at UTC noon so any tz (±11h) keeps the day. */
function toDate(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T12:00:00.000Z`)
    if (Number.isNaN(parsed.getTime())) throw apiErrors.validation('Invalid transaction date')
    return parsed
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw apiErrors.validation('Invalid transaction date')
  return parsed
}

function dayStart(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function dayEndExclusive(value: string): Date {
  const d = dayStart(value)
  d.setUTCDate(d.getUTCDate() + 1)
  return d
}

/* ------------------------------- row helpers ------------------------------- */

/** Base projection: transaction joined with its account/category display data. */
function baseSelect(db: ReturnType<typeof getDatabase>) {
  return db
    .select({
      id: transactions.id,
      userId: transactions.userId,
      accountId: transactions.accountId,
      transferGroupId: transactions.transferGroupId,
      transferDirection: transactions.transferDirection,
      idempotencyKey: transactions.idempotencyKey,
      categoryId: transactions.categoryId,
      type: transactions.type,
      amount: transactions.amount,
      description: transactions.description,
      merchant: transactions.merchant,
      notes: transactions.notes,
      transactionDate: transactions.transactionDate,
      createdAt: transactions.createdAt,
      updatedAt: transactions.updatedAt,
      deletedAt: transactions.deletedAt,
      accountName: accounts.name,
      categoryName: categories.name,
      categoryColor: categories.color,
      toAccountId: sql<string | null>`null`,
      toAccountName: sql<string | null>`null`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
}

/**
 * Resolve transfer legs for a page of rows: attach destination info and drop
 * non-canonical legs so one transfer renders as ONE transaction (PRD §21).
 */
async function attachTransferContext(rows: RowShape[]): Promise<RowShape[]> {
  const groupIds = [
    ...new Set(
      rows
        .filter((r) => r.type === 'transfer' && r.transferGroupId)
        .map((r) => r.transferGroupId as string),
    ),
  ]
  if (groupIds.length === 0) return rows
  const db = getDatabase()
  const legs = await db
    .select({
      id: transactions.id,
      transferGroupId: transactions.transferGroupId,
      transferDirection: transactions.transferDirection,
      accountId: transactions.accountId,
      accountName: accounts.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(and(inArray(transactions.transferGroupId, groupIds), isNull(transactions.deletedAt)))
  const byGroup = new Map<string, { source: typeof legs[number] | null; dest: typeof legs[number] | null }>()
  for (const leg of legs) {
    const key = leg.transferGroupId as string
    const entry = byGroup.get(key) ?? { source: null, dest: null }
    if (leg.transferDirection === 'out') entry.source = leg
    else entry.dest = leg
    byGroup.set(key, entry)
  }
  return rows.map((row) => {
    if (row.type !== 'transfer' || !row.transferGroupId) return row
    const pair = byGroup.get(row.transferGroupId)
    if (!pair) return row
    return {
      ...row,
      accountId: pair.source?.accountId ?? row.accountId,
      accountName: pair.source?.accountName ?? row.accountName,
      toAccountId: pair.dest?.accountId ?? null,
      toAccountName: pair.dest?.accountName ?? null,
    }
  })
}

/** Fetch a live transaction owned by the user, or 404 (never leaks existence). */
async function getOwnedRow(userId: string, id: string): Promise<RowShape> {
  const rows = await baseSelect(getDatabase())
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId), isNull(transactions.deletedAt)))
    .limit(1)
  const row = rows[0]
  if (!row) throw apiErrors.notFound('Transaction not found')
  const resolved = await attachTransferContext([row])
  return resolved[0] ?? row
}

/* --------------------------------- creation --------------------------------- */

async function findByIdempotencyKey(userId: string, key: string): Promise<RowShape | null> {
  const rows = await baseSelect(getDatabase())
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.idempotencyKey, key),
        isNull(transactions.deletedAt),
      ),
    )
    .limit(1)
  const row = rows[0]
  if (!row) return null
  const resolved = await attachTransferContext([row])
  return resolved[0] ?? row
}

async function assertAccountUsable(userId: string, accountId: string) {
  const account = await getOwnedAccount(userId, accountId)
  if (account.status !== 'active') {
    throw apiErrors.validation('This account is archived')
  }
  return account
}

export async function createTransaction(
  event: H3Event,
  userId: string,
  input: TransactionCreateInput,
): Promise<CreateResult> {
  // Replay protection: the same idempotency key returns the first result.
  if (input.idempotencyKey) {
    const existing = await findByIdempotencyKey(userId, input.idempotencyKey)
    if (existing) {
      return { transaction: toDTO(existing), deduplicated: true }
    }
  }

  const transactionDate = toDate(input.transactionDate)
  const source = await assertAccountUsable(userId, input.accountId)

  if (input.type === 'transfer') {
    if (!input.toAccountId) throw apiErrors.validation('Destination account is required for transfers')
    if (input.toAccountId === source.id) {
      throw apiErrors.validation('Transfer source and destination must be different')
    }
    if (input.categoryId) throw apiErrors.validation('Transfers do not use categories')
    const destination = await assertAccountUsable(userId, input.toAccountId)
    const transferGroupId = randomUUID()
    try {
      const db = getDatabase()
      // Atomic pair (PRD §20–§21): both legs or neither (PRD §70).
      const inserted = await db.transaction(async (tx) => {
        const [outLeg] = await tx
          .insert(transactions)
          .values({
            userId,
            accountId: source.id,
            transferGroupId,
            transferDirection: 'out',
            type: 'transfer',
            amount: input.amount,
            description: input.description ?? null,
            merchant: input.merchant ?? null,
            notes: input.notes ?? null,
            transactionDate,
            idempotencyKey: input.idempotencyKey ?? null,
          })
          .returning({ id: transactions.id })
        const [inLeg] = await tx
          .insert(transactions)
          .values({
            userId,
            accountId: destination.id,
            transferGroupId,
            transferDirection: 'in',
            type: 'transfer',
            amount: input.amount,
            description: input.description ?? null,
            merchant: input.merchant ?? null,
            notes: input.notes ?? null,
            transactionDate,
          })
          .returning({ id: transactions.id })
        if (!outLeg || !inLeg) throw apiErrors.internal()
        return { outId: outLeg.id }
      })
      await audit(event, 'transfer_created', {
        userId,
        entityType: 'transaction',
        entityId: inserted.outId,
        metadata: { amount: input.amount, from: source.id, to: destination.id },
      })
      const row = await getOwnedRow(userId, inserted.outId)
      return { transaction: toDTO(row), deduplicated: false }
    } catch (err) {
      if (isUniqueViolation(err) && input.idempotencyKey) {
        const existing = await findByIdempotencyKey(userId, input.idempotencyKey)
        if (existing) return { transaction: toDTO(existing), deduplicated: true }
      }
      throw err
    }
  }

  // income / expense
  if (input.categoryId) {
    await assertCategoryUsable(userId, input.categoryId, input.type === 'income' ? 'income' : 'expense')
  }
  const values = {
    userId,
    accountId: source.id,
    type: input.type,
    amount: input.amount,
    categoryId: input.categoryId ?? null,
    description: input.description ?? null,
    merchant: input.merchant ?? null,
    notes: input.notes ?? null,
    transactionDate,
    idempotencyKey: input.idempotencyKey ?? null,
    transferGroupId: null,
    transferDirection: null,
  }
  try {
    const inserted = await getDatabase()
      .insert(transactions)
      .values(values)
      .returning({ id: transactions.id })
    const created = inserted[0]
    if (!created) throw apiErrors.internal()
    await audit(event, 'transaction_created', {
      userId,
      entityType: 'transaction',
      entityId: created.id,
      metadata: { type: input.type, amount: input.amount },
    })
    const row = await getOwnedRow(userId, created.id)
    return { transaction: toDTO(row), deduplicated: false }
  } catch (err) {
    if (isUniqueViolation(err) && input.idempotencyKey) {
      const existing = await findByIdempotencyKey(userId, input.idempotencyKey)
      if (existing) return { transaction: toDTO(existing), deduplicated: true }
    }
    throw err
  }
}

/* --------------------------------- update ---------------------------------- */

export async function updateTransaction(
  event: H3Event,
  userId: string,
  id: string,
  input: TransactionUpdateInput,
): Promise<TransactionDTO> {
  const existing = await getOwnedRow(userId, id)
  const isTransfer = existing.type === 'transfer'

  if (isTransfer) {
    // Transfers keep their accounts; mutate amount/date/memo atomically (PRD §20).
    if (
      (input.accountId && input.accountId !== existing.accountId) ||
      (input.toAccountId && input.toAccountId !== existing.toAccountId)
    ) {
      throw apiErrors.validation(
        'Transfer accounts cannot be edited — delete the transfer and create a new one',
      )
    }
    if (input.categoryId) {
      throw apiErrors.validation('Transfers do not use categories')
    }
    const transferDate = input.transactionDate ? toDate(input.transactionDate) : null
    const db = getDatabase()
    await db.transaction(async (tx) => {
      const groupId = existing.transferGroupId
      if (groupId) {
        const sibling = await tx
          .select({ id: transactions.id, amount: transactions.amount })
          .from(transactions)
          .where(
            and(
              eq(transactions.transferGroupId, groupId),
              sql`${transactions.id} <> ${existing.id}`,
              isNull(transactions.deletedAt),
            ),
          )
          .limit(1)
        if (!sibling[0]) throw apiErrors.notFound('Transfer is incomplete')
      }
      await tx
        .update(transactions)
        .set({
          ...(input.amount !== undefined ? { amount: input.amount } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.merchant !== undefined ? { merchant: input.merchant } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(transferDate ? { transactionDate: transferDate } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(transactions.userId, userId), eq(transactions.id, existing.id)))
      if (groupId) {
        await tx
          .update(transactions)
          .set({
            ...(input.amount !== undefined ? { amount: input.amount } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
            ...(transferDate ? { transactionDate: transferDate } : {}),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(transactions.transferGroupId, groupId),
              sql`${transactions.id} <> ${existing.id}`,
              eq(transactions.userId, userId),
            ),
          )
      }
    })
    await audit(event, 'transaction_updated', {
      userId,
      entityType: 'transaction',
      entityId: existing.id,
      metadata: { type: 'transfer', fields: Object.keys(input) },
    })
    return toDTO(await getOwnedRow(userId, existing.id))
  }

  if (input.accountId && input.accountId !== existing.accountId) {
    await assertAccountUsable(userId, input.accountId)
  }
  if (input.categoryId) {
    await assertCategoryUsable(
      userId,
      input.categoryId,
      existing.type === 'income' ? 'income' : 'expense',
    )
  }
  await getDatabase()
    .update(transactions)
    .set({
      ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.merchant !== undefined ? { merchant: input.merchant } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.transactionDate !== undefined
        ? { transactionDate: toDate(input.transactionDate) }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(transactions.id, existing.id), eq(transactions.userId, userId), isNull(transactions.deletedAt)))
  await audit(event, 'transaction_updated', {
    userId,
    entityType: 'transaction',
    entityId: existing.id,
    metadata: { type: existing.type, fields: Object.keys(input) },
  })
  return toDTO(await getOwnedRow(userId, existing.id))
}

/* --------------------------------- deletion -------------------------------- */

/** Soft delete (PRD §22, §60): history is retained, balance re-derives. */
export async function deleteTransaction(
  event: H3Event,
  userId: string,
  id: string,
): Promise<{ deleted: true; id: string }> {
  const existing = await getOwnedRow(userId, id)
  const now = new Date()
  const db = getDatabase()
  const existingGroupId = existing.transferGroupId
  if (existing.type === 'transfer' && existingGroupId) {
    await db.transaction(async (tx) => {
      await tx
        .update(transactions)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(transactions.transferGroupId, existingGroupId), eq(transactions.userId, userId)))
    })
  } else {
    await db
      .update(transactions)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(transactions.id, existing.id), eq(transactions.userId, userId), isNull(transactions.deletedAt)))
  }
  await audit(event, 'transaction_deleted', {
    userId,
    entityType: 'transaction',
    entityId: existing.id,
    metadata: { type: existing.type, amount: existing.amount },
  })
  return { deleted: true, id: existing.id }
}

/* ---------------------------------- listing -------------------------------- */

export interface TransactionListResult {
  transactions: TransactionDTO[]
  total: number
  page: number
  pageSize: number
  pages: number
  summary: { income: string; expense: string; net: string }
}

function buildFilters(userId: string, query: TransactionListQuery): SQL[] {
  const filters: SQL[] = [
    eq(transactions.userId, userId),
    isNull(transactions.deletedAt),
  ]
  if (query.type === 'transfer') {
    filters.push(eq(transactions.type, 'transfer'))
  } else if (query.type) {
    filters.push(eq(transactions.type, query.type))
  }
  if (query.from) filters.push(gte(transactions.transactionDate, dayStart(query.from)))
  if (query.to) filters.push(lt(transactions.transactionDate, dayEndExclusive(query.to)))
  if (query.accountId) {
    filters.push(
      sql`(${transactions.accountId} = ${query.accountId}
        or ${transactions.transferGroupId} in (
          select ${transactions.transferGroupId} from ${transactions}
          where ${transactions.accountId} = ${query.accountId}
            and ${transactions.transferGroupId} is not null
            and ${transactions.deletedAt} is null
        ))`,
    )
  }
  if (query.categoryId) filters.push(eq(transactions.categoryId, query.categoryId))
  if (query.search) {
    const like = `%${query.search}%`
    filters.push(
      sql`(${transactions.description} ilike ${like}
        or ${transactions.merchant} ilike ${like}
        or ${transactions.notes} ilike ${like})`,
    )
  }
  if (query.minAmount) filters.push(sql`${transactions.amount} >= ${query.minAmount}`)
  if (query.maxAmount) filters.push(sql`${transactions.amount} <= ${query.maxAmount}`)
  return filters
}

/** Canonical rows only: transfers count/render once (source leg). */
function canonicalClause(): SQL {
  return sql`(${transactions.type} <> 'transfer' or ${transactions.transferDirection} = 'out')`
}

export async function listTransactions(
  userId: string,
  query: TransactionListQuery,
): Promise<TransactionListResult> {
  const db = getDatabase()
  const filters = buildFilters(userId, query)
  const pageFilters = [...filters, canonicalClause()]

  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(...pageFilters))
  const total = countRows[0]?.count ?? 0
  const pages = Math.max(1, Math.ceil(total / query.pageSize))

  const offset = (query.page - 1) * query.pageSize
  const rows = (await baseSelect(db)
    .where(and(...pageFilters))
    .orderBy(desc(transactions.transactionDate), desc(transactions.createdAt), desc(transactions.id))
    .limit(query.pageSize)
    .offset(offset)) as RowShape[]
  const resolved = await attachTransferContext(rows)

  const summaryRows = await db
    .select({
      income: sql<string>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amount} else 0 end), 0)`,
      expense: sql<string>`coalesce(sum(case when ${transactions.type} = 'expense' then ${transactions.amount} else 0 end), 0)`,
    })
    .from(transactions)
    .where(and(...filters, canonicalClause()))
  const income = summaryRows[0]?.income ?? '0'
  const expense = summaryRows[0]?.expense ?? '0'

  return {
    transactions: resolved.map(toDTO),
    total,
    page: query.page,
    pageSize: query.pageSize,
    pages,
    summary: {
      income,
      expense,
      net: subMoney(income, expense),
    },
  }
}

export async function getTransaction(userId: string, id: string): Promise<TransactionDTO> {
  return toDTO(await getOwnedRow(userId, id))
}
