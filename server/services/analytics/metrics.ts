import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { getDatabase } from '../../../db/client'
import { accounts, categories, transactions } from '../../../db/schema/index'
import { accountBalanceSql } from '../../repositories/finance'

/**
 * Shared deterministic aggregation SQL (Phases 7/10/11). Every number the UI
 * shows originates here — PostgreSQL is the single source of truth.
 */

export const moneySum = (column: PgColumn): SQLAlias =>
  sql<string>`coalesce(sum(${column}), 0)::numeric`

type SQLAlias = ReturnType<typeof sql<string>>

function liveTx(userId: string, from: Date, toExclusive: Date) {
  return and(
    eq(transactions.userId, userId),
    isNull(transactions.deletedAt),
    sql`${transactions.transactionDate} >= ${from}`,
    sql`${transactions.transactionDate} < ${toExclusive}`,
  )
}

export interface IncomeExpenseWindow {
  income: string
  expense: string
  net: string
}

export async function incomeExpenseWindow(
  userId: string,
  from: Date,
  toExclusive: Date,
): Promise<IncomeExpenseWindow> {
  const rows = await getDatabase()
    .select({
      income: sql<string>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amount} else 0 end), 0)::numeric`,
      expense: sql<string>`coalesce(sum(case when ${transactions.type} = 'expense' then ${transactions.amount} else 0 end), 0)::numeric`,
    })
    .from(transactions)
    .where(liveTx(userId, from, toExclusive))
  const income = rows[0]?.income ?? '0'
  const expense = rows[0]?.expense ?? '0'
  return { income, expense, net: subtract(income, expense) }
}

function toCents(money: string): bigint {
  const negative = money.startsWith('-')
  const body = negative ? money.slice(1) : money
  const [i = '0', f = '0'] = body.split('.')
  const cents = BigInt(i) * 100n + BigInt(f.padEnd(2, '0').slice(0, 2))
  return negative ? -cents : cents
}

export function subtract(a: string, b: string): string {
  const result = toCents(a) - toCents(b)
  const negative = result < 0n
  const abs = negative ? -result : result
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`
}

export interface SeriesPoint {
  /** 'YYYY-MM-DD' for day granularity, 'YYYY-MM' for month. */
  period: string
  income: string
  expense: string
  net: string
}

/** Dense income/expense series; gaps are filled with zeros server-side. */
export async function incomeExpenseSeries(
  userId: string,
  from: Date,
  toExclusive: Date,
  granularity: 'day' | 'month',
): Promise<SeriesPoint[]> {
  const rows = await getDatabase()
    .select({
      bucket: sql<string>`to_char(date_trunc(${granularity}, ${transactions.transactionDate}), ${granularity === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM'})`,
      income: sql<string>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amount} else 0 end), 0)::numeric`,
      expense: sql<string>`coalesce(sum(case when ${transactions.type} = 'expense' then ${transactions.amount} else 0 end), 0)::numeric`,
    })
    .from(transactions)
    .where(liveTx(userId, from, toExclusive))
    .groupBy(sql`bucket`)
    .orderBy(sql`bucket`)
  const byPeriod = new Map(rows.map((r) => [r.bucket, r]))
  const points: SeriesPoint[] = []
  if (granularity === 'month') {
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1))
    const end = new Date(Date.UTC(toExclusive.getUTCFullYear(), toExclusive.getUTCMonth(), 1))
    while (cursor.getTime() < end.getTime()) {
      const key = cursor.toISOString().slice(0, 7)
      const hit = byPeriod.get(key)
      const income = hit?.income ?? '0'
      const expense = hit?.expense ?? '0'
      points.push({ period: key, income, expense, net: subtract(income, expense) })
      cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    }
  } else {
    const cursor = new Date(from)
    while (cursor.getTime() < toExclusive.getTime()) {
      const key = cursor.toISOString().slice(0, 10)
      const hit = byPeriod.get(key)
      const income = hit?.income ?? '0'
      const expense = hit?.expense ?? '0'
      points.push({ period: key, income, expense, net: subtract(income, expense) })
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
  }
  return points
}

export interface AccountBalance {
  id: string
  name: string
  type: string
  status: string
  balance: string
}

/** Authoritative balances — one calculation path, NUMERIC math, no floats. */
export async function accountBalances(userId: string): Promise<AccountBalance[]> {
  return getDatabase()
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      status: accounts.status,
      balance: sql<string>`(${accountBalanceSql()})::numeric`,
    })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.status, 'active')))
    .orderBy(accounts.name)
}

export interface CategorySpend {
  categoryId: string | null
  categoryName: string
  categoryColor: string | null
  total: string
  sharePercent: number
}

export async function categorySpend(
  userId: string,
  from: Date,
  toExclusive: Date,
): Promise<CategorySpend[]> {
  const rows = await getDatabase()
    .select({
      categoryId: transactions.categoryId,
      total: sql<string>`coalesce(sum(${transactions.amount}), 0)::numeric`,
      categoryName: sql<string>`coalesce(${categories.name}, 'Uncategorized')`,
      categoryColor: categories.color,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.type, 'expense'),
        isNull(transactions.deletedAt),
        sql`${transactions.transactionDate} >= ${from}`,
        sql`${transactions.transactionDate} < ${toExclusive}`,
      ),
    )
    .groupBy(transactions.categoryId, categories.name, categories.color)
    .orderBy(sql`sum(${transactions.amount}) desc`)
  const grand = rows.reduce((acc, r) => acc + toCents(r.total), 0n)
  return rows.map((r) => ({
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    categoryColor: r.categoryColor,
    total: r.total,
    sharePercent:
      grand === 0n ? 0 : Number(((toCents(r.total) * 10_000n) / grand) / 100n) / 100,
  }))
}

/** Expense totals per category inside a window (budget adherence, health). */
export async function spentTotalsByCategory(
  userId: string,
  from: Date,
  toExclusive: Date,
  categoryIds: string[],
): Promise<Map<string, bigint>> {
  if (categoryIds.length === 0) return new Map()
  const rows = await getDatabase()
    .select({
      categoryId: transactions.categoryId,
      total: sql<string>`coalesce(sum(${transactions.amount}), 0)::numeric`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.type, 'expense'),
        isNull(transactions.deletedAt),
        sql`${transactions.transactionDate} >= ${from}`,
        sql`${transactions.transactionDate} < ${toExclusive}`,
        inArray(transactions.categoryId, categoryIds),
      ),
    )
    .groupBy(transactions.categoryId)
  const map = new Map<string, bigint>()
  for (const row of rows) {
    if (row.categoryId) map.set(row.categoryId, toCents(row.total))
  }
  return map
}

export { toCents }

export const DAY_MS = 86_400_000

export function daysAgo(asOf: Date, days: number): Date {
  return new Date(asOf.getTime() - days * DAY_MS)
}

export function startOfDayUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export function nextDayUtc(date: Date): Date {
  const d = startOfDayUtc(date)
  d.setUTCDate(d.getUTCDate() + 1)
  return d
}

export function monthStartUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

export function nextMonthUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
}
