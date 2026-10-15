import { sql, type SQL } from 'drizzle-orm'
import { getDatabase } from '../../db/client'
import { accounts, transactions } from '../../db/schema/index'

/**
 * Shared money SQL (PRD §17, §26): every balance/aggregate is computed by
 * PostgreSQL NUMERIC arithmetic — JavaScript never does authoritative money math.
 */

/** Net impact of one transaction row on the balance of its account. */
export function transactionImpactSql(): SQL {
  return sql`case
    when ${transactions.type} = 'income' then ${transactions.amount}
    when ${transactions.type} = 'expense' then -${transactions.amount}
    when ${transactions.transferDirection} = 'in' then ${transactions.amount}
    else -${transactions.amount}
  end`
}

/**
 * Current balance of an account:
 * initial_balance + Σ(live transaction impacts). Single authoritative strategy —
 * there is no second stored balance to drift out of sync (PRD §16, §26).
 */
export function accountBalanceSql(accountRef: SQL = sql`${accounts.id}`): SQL {
  return sql`(${accounts.initialBalance} + coalesce((
    select sum(${transactionImpactSql()})
    from ${transactions}
    where ${transactions.accountId} = ${accountRef}
      and ${transactions.deletedAt} is null
  ), 0))`
}

/** Live transactions count for an account. */
export function accountTransactionCountSql(): SQL<number> {
  return sql`(select count(*)::int from ${transactions}
    where ${transactions.accountId} = ${accounts.id}
      and ${transactions.deletedAt} is null)`
}

export interface FlowTotals {
  income: string
  expense: string
}

/** Income/expense sums over a half-open date window (PRD §26, §34). */
export async function flowTotals(
  userId: string,
  from: Date,
  to: Date,
): Promise<FlowTotals> {
  const rows = await getDatabase()
    .select({
      income: sql<string>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amount} else 0 end), 0)`,
      expense: sql<string>`coalesce(sum(case when ${transactions.type} = 'expense' then ${transactions.amount} else 0 end), 0)`,
    })
    .from(transactions)
    .where(
      sql`${transactions.userId} = ${userId}
        and ${transactions.deletedAt} is null
        and ${transactions.type} in ('income', 'expense')
        and ${transactions.transactionDate} >= ${from}
        and ${transactions.transactionDate} < ${to}`,
    )
  return rows[0] ?? { income: '0', expense: '0' }
}

/** Sum of live impacts across accounts (default: active accounts only). */
export async function totalBalance(
  userId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<string> {
  const statusFilter = opts.includeArchived
    ? sql``
    : sql`and ${accounts.status} = 'active'`
  const rows = await getDatabase()
    .select({ total: sql<string>`coalesce(sum(${accountBalanceSql()}), 0)` })
    .from(accounts)
    .where(sql`${accounts.userId} = ${userId} ${statusFilter}`)
  return rows[0]?.total ?? '0'
}

export interface FlowPoint {
  bucket: string
  income: string
  expense: string
}

/** Bucketed income/expense series (PRD §27, §34). `truncateExpr` is a date_trunc. */
export async function flowSeries(
  userId: string,
  from: Date,
  to: Date,
  truncateExpr: 'day' | 'week' | 'month',
): Promise<FlowPoint[]> {
  return getDatabase()
    .select({
      bucket: sql<string>`to_char(date_trunc('${sql.raw(truncateExpr)}', ${transactions.transactionDate}), 'YYYY-MM-DD')`,
      income: sql<string>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amount} else 0 end), 0)`,
      expense: sql<string>`coalesce(sum(case when ${transactions.type} = 'expense' then ${transactions.amount} else 0 end), 0)`,
    })
    .from(transactions)
    .where(
      sql`${transactions.userId} = ${userId}
        and ${transactions.deletedAt} is null
        and ${transactions.type} in ('income', 'expense')
        and ${transactions.transactionDate} >= ${from}
        and ${transactions.transactionDate} < ${to}`,
    )
    .groupBy(sql`date_trunc('${sql.raw(truncateExpr)}', ${transactions.transactionDate})`)
    .orderBy(sql`date_trunc('${sql.raw(truncateExpr)}', ${transactions.transactionDate})`)
}

/** PostgreSQL unique-violation code (PRD §22 replay handling). */
export function isUniqueViolation(err: unknown): boolean {
  // DrizzleQueryError wraps the original pg error in `cause`; unwrap a few levels.
  let current = err as { code?: string; cause?: unknown } | null | undefined
  for (let depth = 0; current && depth < 3; depth++) {
    if (current.code === '23505') return true
    current = current.cause as typeof current
  }
  return false
}
