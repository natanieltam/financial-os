import {
  accountBalances,
  categorySpend,
  incomeExpenseSeries,
  incomeExpenseWindow,
  nextDayUtc,
  startOfDayUtc,
  subtract,
} from '../analytics/metrics'
import { computeHealthScore } from '../analytics/health'
import { listBudgets } from '../budgets/service'
import { computeBudgetWindow } from '../budgets/window'
import type { BudgetPeriod } from '../../../shared/constants/finance'

/**
 * Reports & Analytics (PRD §32–§33). Deterministic server-side computations
 * over real data; charts on the client render exactly these numbers.
 */

export type ReportPeriod = '7d' | '30d' | '90d' | '1m' | '3m' | '6m' | '1y'

export const REPORT_PERIOD_DAYS: Record<ReportPeriod, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1m': 30,
  '3m': 91,
  '6m': 182,
  '1y': 365,
}

export interface PeriodRange {
  from: Date
  toExclusive: Date
  previousFrom: Date
}

/** Period window ending today, plus the comparable previous window. */
export function periodRange(period: ReportPeriod, asOf: Date): PeriodRange {
  const days = REPORT_PERIOD_DAYS[period]
  const toExclusive = nextDayUtc(asOf)
  const from = new Date(toExclusive.getTime() - days * 86_400_000)
  const previousFrom = new Date(from.getTime() - days * 86_400_000)
  return { from, toExclusive, previousFrom }
}

const round1 = (v: number): number => Math.round(v * 10) / 10

export interface SummaryReport {
  period: ReportPeriod
  from: string
  to: string
  current: { income: string; expense: string; net: string }
  previous: { income: string; expense: string; net: string }
  change: { incomePercent: number | null; expensePercent: number | null }
  averageMonthlyExpense: string
  savingsRatePercent: number | null
  granularity: 'day' | 'month'
}

function percentChange(current: string, previous: string): number | null {
  const toCents = (v: string): bigint => {
    const negative = v.startsWith('-')
    const body = negative ? v.slice(1) : v
    const [i = '0', f = '0'] = body.split('.')
    const cents = BigInt(i) * 100n + BigInt(f.padEnd(2, '0').slice(0, 2))
    return negative ? -cents : cents
  }
  const prev = toCents(previous)
  if (prev === 0n) return null
  const cur = toCents(current)
  return round1(Number(((cur - prev) * 10_000n) / (prev < 0n ? -prev : prev)) / 100)
}

export async function summaryReport(
  userId: string,
  period: ReportPeriod,
  asOf: Date,
): Promise<SummaryReport> {
  const range = periodRange(period, asOf)
  const [current, previous] = await Promise.all([
    incomeExpenseWindow(userId, range.from, range.toExclusive),
    incomeExpenseWindow(userId, range.previousFrom, range.from),
  ])
  const days = REPORT_PERIOD_DAYS[period]
  const months = Math.max(1, days / 30)
  const toCents = (v: string): bigint => {
    const [i = '0', f = '0'] = v.split('.')
    return BigInt(i) * 100n + BigInt(f.padEnd(2, '0').slice(0, 2))
  }
  const avgMonthlyExpenseCents = toCents(current.expense) / BigInt(Math.round(months))
  const avgMonthlyExpense = `${avgMonthlyExpenseCents / 100n}.${(avgMonthlyExpenseCents % 100n).toString().padStart(2, '0')}`
  const incomeCents = toCents(current.income)
  const savingsRatePercent =
    incomeCents > 0n
      ? round1(Number(((incomeCents - toCents(current.expense)) * 10_000n) / incomeCents) / 100)
      : null
  return {
    period,
    from: startOfDayUtc(range.from).toISOString(),
    to: startOfDayUtc(range.toExclusive).toISOString(),
    current,
    previous,
    change: {
      incomePercent: percentChange(current.income, previous.income),
      expensePercent: percentChange(current.expense, previous.expense),
    },
    averageMonthlyExpense: avgMonthlyExpense,
    savingsRatePercent,
    granularity: days > 45 ? 'month' : 'day',
  }
}

export interface CashflowReport {
  granularity: 'day' | 'month'
  points: Array<{ period: string; income: string; expense: string; net: string }>
}

export async function cashflowReport(
  userId: string,
  from: Date,
  toExclusive: Date,
  granularity: 'day' | 'month',
): Promise<CashflowReport> {
  const points = await incomeExpenseSeries(userId, from, toExclusive, granularity)
  return { granularity, points }
}

export interface CategoryReport {
  from: string
  to: string
  totalExpense: string
  categories: Awaited<ReturnType<typeof categorySpend>>
}

export async function categoryReport(
  userId: string,
  from: Date,
  toExclusive: Date,
): Promise<CategoryReport> {
  const categories = await categorySpend(userId, from, toExclusive)
  const totalExpense = categories.reduce(
    (acc, c) => {
      const [i = '0', f = '0'] = acc.split('.')
      const [ci = '0', cf = '0'] = c.total.split('.')
      const cents = BigInt(i) * 100n + BigInt(f.padEnd(2, '0').slice(0, 2)) + BigInt(ci) * 100n + BigInt(cf.padEnd(2, '0').slice(0, 2))
      return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`
    },
    '0.00',
  )
  return {
    from: startOfDayUtc(from).toISOString(),
    to: startOfDayUtc(toExclusive).toISOString(),
    totalExpense,
    categories,
  }
}

export interface AccountReport {
  accounts: Awaited<ReturnType<typeof accountBalances>>
  total: string
}

export async function accountReport(userId: string): Promise<AccountReport> {
  const accounts = await accountBalances(userId)
  const total = accounts.reduce(
    (acc, account) => {
      const toC = (v: string): bigint => {
        const negative = v.startsWith('-')
        const body = negative ? v.slice(1) : v
        const [i = '0', f = '0'] = body.split('.')
        const cents = BigInt(i) * 100n + BigInt(f.padEnd(2, '0').slice(0, 2))
        return negative ? -cents : cents
      }
      const sum = toC(acc) + toC(account.balance)
      const negative = sum < 0n
      const abs = negative ? -sum : sum
      return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`
    },
    '0.00',
  )
  return { accounts, total }
}

export interface BudgetReportBudget {
  id: string
  name: string
  period: string
  window: { start: string; end: string }
  totals: { budgeted: string; spent: string; remaining: string; percent: number; status: string }
  overspend: string
}

export interface BudgetReport {
  budgets: BudgetReportBudget[]
  aggregate: { budgeted: string; spent: string; overspend: string; adherencePercent: number | null }
}

export async function budgetReport(userId: string, asOf: Date): Promise<BudgetReport> {
  const rows = await listBudgets(userId, { asOf })
  let budgetedCents = 0n
  let spentCents = 0n
  let overspendCents = 0n
  const toC = (v: string): bigint => {
    const [i = '0', f = '0'] = v.split('.')
    return BigInt(i) * 100n + BigInt(f.padEnd(2, '0').slice(0, 2))
  }
  const budgetsOut: BudgetReportBudget[] = rows.map((b) => {
    const budgeted = toC(b.totals.budgeted)
    const spent = toC(b.totals.spent)
    const over = spent > budgeted ? spent - budgeted : 0n
    budgetedCents += budgeted
    spentCents += spent
    overspendCents += over
    return {
      id: b.id,
      name: b.name,
      period: b.period,
      window: b.window,
      totals: b.totals,
      overspend: `${over / 100n}.${(over % 100n).toString().padStart(2, '0')}`,
    }
  })
  const adherencePercent =
    budgetedCents > 0n
      ? round1(Number(((budgetedCents - overspendCents) * 10_000n) / budgetedCents) / 100)
      : null
  return {
    budgets: budgetsOut,
    aggregate: {
      budgeted: `${budgetedCents / 100n}.${(budgetedCents % 100n).toString().padStart(2, '0')}`,
      spent: `${spentCents / 100n}.${(spentCents % 100n).toString().padStart(2, '0')}`,
      overspend: `${overspendCents / 100n}.${(overspendCents % 100n).toString().padStart(2, '0')}`,
      adherencePercent,
    },
  }
}

export { computeBudgetWindow, computeHealthScore, subtract }
export type { BudgetPeriod }
