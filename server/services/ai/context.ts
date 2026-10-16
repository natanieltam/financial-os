import { accountBalances, categorySpend, incomeExpenseWindow, startOfDayUtc } from '../analytics/metrics'
import { computeHealthScore } from '../analytics/health'
import { listBudgets } from '../budgets/service'
import { listGoals } from '../goals/service'
import { computeForecast } from '../forecast/service'
import { moneyToCents } from '../../../shared/money'

/**
 * Financial Context Builder (Phase 15, PRD §38–§39). The server computes
 * every authoritative number FIRST; AI only receives this minimal, aggregated
 * context and may never query the database or invent figures.
 */

export interface FinancialContext {
  asOf: string
  totals: {
    thisMonth: { income: string; expense: string; net: string }
    lastMonth: { income: string; expense: string; net: string }
  }
  categories: Array<{ name: string; spent: string }>
  accounts: Array<{ name: string; balance: string }>
  budgets: Array<{ name: string; period: string; budgeted: string; spent: string; status: string }>
  goals: Array<{ name: string; target: string; current: string; progressPercent: number }>
  health: { score: number | null; status: string } | null
  forecast30d: {
    days: number
    projectedEndBalance: string
    willBeNegative: boolean
  } | null
  hasData: boolean
}

function monthRange(anchor: Date, monthOffset: number): { from: Date; to: Date } {
  const from = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + monthOffset, 1))
  const to = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + monthOffset + 1, 1))
  return { from, to }
}

/** Builds the authoritative context. Compact aggregates only — never raw rows. */
export async function buildFinancialContext(userId: string, asOf: Date = new Date()): Promise<FinancialContext> {
  const today = startOfDayUtc(asOf)
  const thisMonth = monthRange(today, 0)
  const lastMonth = monthRange(today, -1)

  const [thisTotals, lastTotals, balances, spend, budgets, goals, health, forecast] = await Promise.all([
    incomeExpenseWindow(userId, thisMonth.from, thisMonth.to),
    incomeExpenseWindow(userId, lastMonth.from, lastMonth.to),
    accountBalances(userId),
    categorySpend(userId, thisMonth.from, thisMonth.to),
    listBudgets(userId),
    listGoals(userId),
    computeHealthScore(userId, today).catch(() => null),
    computeForecast(userId, 30, today).catch(() => null),
  ])

  const hasData =
    balances.some((b) => moneyToCents(b.balance) !== 0n) ||
    moneyToCents(thisTotals.income) > 0n ||
    moneyToCents(thisTotals.expense) > 0n

  return {
    asOf: today.toISOString().slice(0, 10),
    totals: {
      thisMonth: { income: thisTotals.income, expense: thisTotals.expense, net: thisTotals.net },
      lastMonth: { income: lastTotals.income, expense: lastTotals.expense, net: lastTotals.net },
    },
    categories: spend.slice(0, 8).map((c) => ({ name: c.categoryName ?? 'Tanpa kategori', spent: c.total })),
    accounts: balances.map((b) => ({ name: b.name, balance: b.balance })),
    budgets: budgets.map((b) => ({
      name: b.name,
      period: b.period,
      budgeted: b.totals.budgeted,
      spent: b.totals.spent,
      status: b.totals.status,
    })),
    goals: goals.map((g) => ({
      name: g.name,
      target: g.targetAmount,
      current: g.currentAmount,
      progressPercent: g.progressPercent,
    })),
    health: health ? { score: health.score, status: health.status } : null,
    forecast30d: forecast
      ? {
          days: forecast.days,
          projectedEndBalance: forecast.projection.projectedEndBalance,
          willBeNegative: forecast.projection.willBeNegative,
        }
      : null,
    hasData,
  }
}

/** Serializes the context compactly for the prompt. */
export function contextToPrompt(context: FinancialContext): string {
  return JSON.stringify({
    asOf: context.asOf,
    currency: 'IDR (all amounts are decimal strings)',
    totals: context.totals,
    accounts: context.accounts,
    categories: context.categories,
    budgets: context.budgets,
    goals: context.goals,
    health: context.health,
    forecast30d: context.forecast30d,
  })
}

