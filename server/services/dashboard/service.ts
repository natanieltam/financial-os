import { and, eq, isNull, sql } from 'drizzle-orm'
import { getDatabase } from '../../../db/client'
import { transactions } from '../../../db/schema/index'
import {
  accountBalances,
  categorySpend,
  daysAgo,
  incomeExpenseSeries,
  incomeExpenseWindow,
  nextDayUtc,
  nextMonthUtc,
  startOfDayUtc,
  subtract,
} from '../analytics/metrics'
import { computeHealthScore } from '../analytics/health'
import { addMoney } from '../../../shared/money'
import { listTransactions } from '../transactions/service'
import { listBudgets } from '../budgets/service'

/**
 * Dashboard (PRD §26–§28): one aggregated payload, real data only, every
 * number computed server-side. Batched queries — no N+1 on transaction lists.
 */

export interface DashboardPayload {
  totals: {
    balance: string
    income: string
    expense: string
    net: string
  }
  month: {
    income: string
    expense: string
    net: string
  }
  previousMonth: {
    income: string
    expense: string
  }
  accounts: Array<{
    id: string
    name: string
    type: string
    balance: string
    transactionCount: number
  }>
  recentTransactions: Awaited<ReturnType<typeof listTransactions>>['transactions']
  cashflow: Array<{ period: string; income: string; expense: string; net: string }>
  topCategories: Array<{
    categoryId: string | null
    categoryName: string
    categoryColor: string | null
    total: string
    sharePercent: number
  }>
  budgets: Array<{
    id: string
    name: string
    percent: number
    status: string
    budgeted: string
    spent: string
  }>
  health: Awaited<ReturnType<typeof computeHealthScore>>
}

export async function getDashboard(userId: string, asOf: Date = new Date()): Promise<DashboardPayload> {
  const db = getDatabase()
  const monthStart = startOfDayUtc(asOf)
  monthStart.setUTCDate(1)
  const monthEnd = nextMonthUtc(monthStart)
  const prevStart = new Date(monthStart)
  prevStart.setUTCMonth(prevStart.getUTCMonth() - 1)

  // One query: lifetime totals; one: this month; one: last month; one: balances.
  const [lifetime, month, previousMonth, balances, counts] = await Promise.all([
    db
      .select({
        income: sql<string>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amount} else 0 end), 0)::numeric`,
        expense: sql<string>`coalesce(sum(case when ${transactions.type} = 'expense' then ${transactions.amount} else 0 end), 0)::numeric`,
      })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt))),
    incomeExpenseWindow(userId, monthStart, monthEnd),
    incomeExpenseWindow(userId, prevStart, monthStart),
    accountBalances(userId),
    db
      .select({
        accountId: transactions.accountId,
        count: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          isNull(transactions.deletedAt),
          sql`(${transactions.type} <> 'transfer' or ${transactions.transferDirection} = 'out')`,
        ),
      )
      .groupBy(transactions.accountId),
  ])

  const lifetimeIncome = lifetime[0]?.income ?? '0'
  const lifetimeExpense = lifetime[0]?.expense ?? '0'
  const countByAccount = new Map(counts.map((c) => [c.accountId, c.count]))
  const accountDtos = balances.map((account) => ({
    id: account.id,
    name: account.name,
    type: account.type,
    balance: account.balance,
    transactionCount: countByAccount.get(account.id) ?? 0,
  }))

  const totalBalanceStr = balances.reduce(
    (acc, account) => addMoney(acc, account.balance),
    '0.00',
  )

  const [cashflow, recent, topCategories, budgets, health] = await Promise.all([
    incomeExpenseSeries(userId, daysAgo(startOfDayUtc(asOf), 89), nextDayUtc(asOf), 'day'),
    listTransactions(userId, {
      page: 1,
      pageSize: 6,
    }),
    categorySpend(userId, monthStart, monthEnd),
    listBudgets(userId, { asOf }),
    computeHealthScore(userId, asOf),
  ])

  return {
    totals: {
      balance: totalBalanceStr,
      income: lifetimeIncome,
      expense: lifetimeExpense,
      net: subtract(lifetimeIncome, lifetimeExpense),
    },
    month: {
      income: month.income,
      expense: month.expense,
      net: month.net,
    },
    previousMonth: {
      income: previousMonth.income,
      expense: previousMonth.expense,
    },
    accounts: accountDtos,
    recentTransactions: recent.transactions,
    cashflow,
    topCategories: topCategories.slice(0, 6),
    budgets: budgets.map((b) => ({
      id: b.id,
      name: b.name,
      percent: b.totals.percent,
      status: b.totals.status,
      budgeted: b.totals.budgeted,
      spent: b.totals.spent,
    })),
    health,
  }
}
