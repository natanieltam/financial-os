import { and, desc, eq, ne, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { getDatabase } from '../../../db/client'
import { accounts } from '../../../db/schema/index'
import type {
  AccountCreateInput,
  AccountUpdateInput,
} from '../../../shared/schemas/finance'
import { accountBalanceSql, accountTransactionCountSql, isUniqueViolation } from '../../repositories/finance'
import { apiErrors } from '../../utils/api'
import { audit } from '../../utils/audit'

/** Safe account payload — balance is computed server-side, never client-trusted. */
export interface AccountDTO {
  id: string
  name: string
  type: string
  currency: string
  initialBalance: string
  balance: string
  status: string
  transactionCount: number
  createdAt: string
  updatedAt: string
}

type AccountRow = typeof accounts.$inferSelect

function toDTO(row: AccountRow, balance: string, transactionCount: number): AccountDTO {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    currency: row.currency,
    initialBalance: row.initialBalance,
    balance,
    status: row.status,
    transactionCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

const notFound = () => apiErrors.notFound('Account not found')

/** Ownership-scoped fetch — client-provided user_id is never consulted (PRD §15). */
export async function getOwnedAccount(userId: string, accountId: string): Promise<AccountRow> {
  const rows = await getDatabase()
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
    .limit(1)
  const row = rows[0]
  if (!row) throw notFound()
  return row
}

export async function listAccounts(
  userId: string,
  opts: { includeArchived?: boolean; type?: string; search?: string } = {},
): Promise<AccountDTO[]> {
  const filters = [eq(accounts.userId, userId)]
  if (!opts.includeArchived) filters.push(eq(accounts.status, 'active'))
  if (opts.type) filters.push(eq(accounts.type, opts.type as AccountRow['type']))
  if (opts.search) {
    filters.push(sql`${accounts.name} ilike ${`%${opts.search}%`}`)
  }
  const rows = await getDatabase()
    .select({
      row: accounts,
      balance: accountBalanceSql(),
      transactionCount: accountTransactionCountSql(),
    })
    .from(accounts)
    .where(and(...filters))
    .orderBy(accounts.status, desc(sql`abs(${accountBalanceSql()})`), accounts.name)
  return rows.map((r) => toDTO(r.row, r.balance as string, (r.transactionCount ?? 0) as number))
}

export async function getAccount(userId: string, accountId: string): Promise<AccountDTO> {
  const row = await getOwnedAccount(userId, accountId)
  const rows = await getDatabase()
    .select({ balance: accountBalanceSql(), transactionCount: accountTransactionCountSql() })
    .from(accounts)
    .where(eq(accounts.id, row.id))
    .limit(1)
  const agg = rows[0]
  if (!agg) throw notFound()
  return toDTO(row, agg.balance as string, (agg.transactionCount ?? 0) as number)
}

export async function createAccount(
  event: H3Event,
  userId: string,
  input: AccountCreateInput,
): Promise<AccountDTO> {
  try {
    const inserted = await getDatabase()
      .insert(accounts)
      .values({
        userId,
        name: input.name,
        type: input.type,
        currency: input.currency,
        initialBalance: input.initialBalance ?? '0',
      })
      .returning()
    const row = inserted[0]
    if (!row) throw apiErrors.internal()
    await audit(event, 'account_created', {
      userId,
      entityType: 'account',
      entityId: row.id,
      metadata: { type: row.type },
    })
    return toDTO(row, row.initialBalance, 0)
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw apiErrors.conflict('An active account with this name already exists')
    }
    throw err
  }
}

export async function updateAccount(
  event: H3Event,
  userId: string,
  accountId: string,
  input: AccountUpdateInput,
): Promise<AccountDTO> {
  const existing = await getOwnedAccount(userId, accountId)
  try {
    const updated = await getDatabase()
      .update(accounts)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.initialBalance !== undefined
          ? { initialBalance: input.initialBalance }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(accounts.id, existing.id), eq(accounts.userId, userId)))
      .returning()
    const row = updated[0]
    if (!row) throw notFound()
    await audit(event, 'account_updated', {
      userId,
      entityType: 'account',
      entityId: row.id,
      metadata: { fields: Object.keys(input) },
    })
    const agg = await getDatabase()
      .select({ balance: accountBalanceSql(), transactionCount: accountTransactionCountSql() })
      .from(accounts)
      .where(eq(accounts.id, row.id))
      .limit(1)
    return toDTO(
      row,
      (agg[0]?.balance as string | undefined) ?? row.initialBalance,
      (agg[0]?.transactionCount as number | undefined) ?? 0,
    )
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw apiErrors.conflict('An active account with this name already exists')
    }
    throw err
  }
}

/**
 * "Delete" = archive (PRD §16 data strategy). Financial history is never
 * destroyed: transactions reference accounts with ON DELETE RESTRICT.
 */
export async function archiveAccount(
  event: H3Event,
  userId: string,
  accountId: string,
): Promise<AccountDTO> {
  const existing = await getOwnedAccount(userId, accountId)
  const updated = await getDatabase()
    .update(accounts)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(and(eq(accounts.id, existing.id), eq(accounts.userId, userId), ne(accounts.status, 'archived')))
    .returning()
  const row = updated[0] ?? existing
  await audit(event, 'account_archived', {
    userId,
    entityType: 'account',
    entityId: row.id,
  })
  const agg = await getDatabase()
    .select({ balance: accountBalanceSql(), transactionCount: accountTransactionCountSql() })
    .from(accounts)
    .where(eq(accounts.id, row.id))
    .limit(1)
  return toDTO(
    row,
    (agg[0]?.balance as string | undefined) ?? row.initialBalance,
    (agg[0]?.transactionCount as number | undefined) ?? 0,
  )
}
