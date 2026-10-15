import { and, eq, sql } from 'drizzle-orm'
import { getDatabase } from '../../../db/client'
import { accounts, budgets, budgetItems } from '../../../db/schema/index'
import { computeBudgetWindow } from '../budgets/window'
import {
  daysAgo,
  incomeExpenseWindow,
  nextDayUtc,
  nextMonthUtc,
  startOfDayUtc,
  spentTotalsByCategory,
  toCents,
} from './metrics'
import { accountBalanceSql } from '../../repositories/finance'

/**
 * Financial Health Score (PRD §33) — deterministic, server-side, reproducible.
 * AI must never calculate or decide the score (PRD §8 / golden rule 4).
 *
 * Components and weights:
 *   savingsRate 25% · expenseStability 20% · emergencyFund 20%
 *   debtRatio 20% · budgetAdherence 15%
 * Raw metrics → 0–100 component scores → weighted total → interpretation.
 */

export const COMPONENT_WEIGHTS = {
  savingsRate: 25,
  expenseStability: 20,
  emergencyFund: 20,
  debtRatio: 20,
  budgetAdherence: 15,
} as const

export type ComponentKey = keyof typeof COMPONENT_WEIGHTS

export interface HealthComponent {
  key: ComponentKey
  label: string
  weight: number
  /** 0–100 with one decimal, or null when data is insufficient. */
  score: number | null
  /** Human-readable raw metric (never invented — null when unavailable). */
  raw: string | null
  interpretation: string
}

export interface HealthResult {
  asOf: string
  /** Weighted average of available components, or null if nothing is computable. */
  score: number | null
  status: 'excellent' | 'good' | 'fair' | 'poor' | 'insufficient-data'
  components: HealthComponent[]
  unavailableComponents: ComponentKey[]
}

const round1 = (v: number): number => Math.round(v * 10) / 10

const clampScore = (v: number): number => Math.min(100, Math.max(0, v))

interface MonthlyPoint {
  income: string
  expense: string
}

/** Last `months` calendar months (including the current partial month). */
async function monthlySeries(userId: string, asOf: Date, months: number): Promise<MonthlyPoint[]> {
  const currentStart = startOfDayUtc(asOf)
  currentStart.setUTCDate(1)
  const points: MonthlyPoint[] = []
  for (let i = months - 1; i >= 0; i--) {
    const start = new Date(currentStart)
    start.setUTCMonth(start.getUTCMonth() - i)
    const end = nextMonthUtc(start)
    points.push(await incomeExpenseWindow(userId, start, end))
  }
  return points
}

/* --------------------------- component computations --------------------------- */

export function scoreSavingsRate(series: MonthlyPoint[]): {
  score: number | null
  raw: string | null
  interpretation: string
} {
  // Ratio only counts months with income (zero-income months aren't "0% saved").
  const ratios: number[] = []
  for (const point of series) {
    const income = toCents(point.income)
    if (income <= 0n) continue
    const saved = income - toCents(point.expense)
    ratios.push(Number((saved * 10_000n) / income) / 10_000)
  }
  if (ratios.length === 0) {
    return {
      score: null,
      raw: null,
      interpretation: 'Needs at least one month with income',
    }
  }
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length
  const percent = round1(avg * 100)
  const score = clampScore((avg / 0.3) * 100) // ≥30% savings → 100
  let interpretation = 'Below target'
  if (avg >= 0.2) interpretation = 'Healthy'
  if (avg >= 0.3) interpretation = 'Excellent'
  return { score: round1(score), raw: `${percent}%`, interpretation }
}

export function scoreExpenseStability(series: MonthlyPoint[]): {
  score: number | null
  raw: string | null
  interpretation: string
} {
  // Use months that saw spending so pre-history zeros don't dilute volatility.
  const values = series
    .map((p) => Number(toCents(p.expense)) / 100)
    .filter((v) => v > 0)
  if (values.length < 2) {
    return {
      score: null,
      raw: null,
      interpretation: 'Needs at least two months with expenses',
    }
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  if (mean === 0) return { score: null, raw: null, interpretation: 'No spending data' }
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length
  const cv = Math.sqrt(variance) / mean // coefficient of variation
  // cv ≤ 0.1 → 100, cv ≥ 0.5 → 0, linear between.
  const score = clampScore((1 - (cv - 0.1) / 0.4) * 100)
  let interpretation = 'Erratic spending'
  if (cv <= 0.5) interpretation = 'Moderate variation'
  if (cv <= 0.3) interpretation = 'Consistent'
  if (cv <= 0.1) interpretation = 'Very consistent'
  return { score: round1(score), raw: `CV ${round1(cv * 100)}%`, interpretation }
}

export async function scoreEmergencyFund(
  userId: string,
  asOf: Date,
  series: MonthlyPoint[],
): Promise<{ score: number | null; raw: string | null; interpretation: string }> {
  // Liquid = balances of active non-credit accounts (credit balances are debt).
  const rows = await getDatabase()
    .select({ balance: sql<string>`(${accountBalanceSql()})::numeric`, type: accounts.type })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.status, 'active')))
  let liquidCents = 0n
  for (const row of rows) {
    if (row.type === 'credit_card') continue
    liquidCents += toCents(row.balance)
  }
  const expenseMonths = series.map((p) => toCents(p.expense)).filter((v) => v > 0n)
  if (expenseMonths.length === 0) {
    return { score: null, raw: null, interpretation: 'Needs expense history' }
  }
  const avgMonthly =
    expenseMonths.reduce((a, b) => a + b, 0n) / BigInt(expenseMonths.length)
  if (avgMonthly <= 0n) {
    return { score: null, raw: null, interpretation: 'Needs expense history' }
  }
  const coverage =
    Number((liquidCents * 100n) / avgMonthly) / 100 // months of runway
  const score = clampScore((coverage / 3) * 100) // 3+ months → 100
  let interpretation = 'Build toward 3 months'
  if (coverage >= 3) interpretation = 'Fully covered (3+ months)'
  else if (coverage >= 1.5) interpretation = 'Getting there'
  return {
    score: round1(score),
    raw: `${round1(coverage)} months`,
    interpretation,
  }
}

export async function scoreDebtRatio(
  userId: string,
  windowFrom: Date,
  windowTo: Date,
): Promise<{ score: number | null; raw: string | null; interpretation: string }> {
  const rows = await getDatabase()
    .select({ balance: sql<string>`(${accountBalanceSql()})::numeric` })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.status, 'active'), eq(accounts.type, 'credit_card')))
  let debtCents = 0n
  for (const row of rows) {
    const balance = toCents(row.balance)
    if (balance < 0n) debtCents += -balance
  }
  const income = await incomeExpenseWindow(userId, windowFrom, windowTo)
  const incomeCents = toCents(income.income)
  if (incomeCents <= 0n) {
    return { score: null, raw: null, interpretation: 'Needs income data' }
  }
  if (debtCents === 0n) {
    return { score: 100, raw: '0%', interpretation: 'Debt free' }
  }
  const ratio = Number((debtCents * 10_000n) / incomeCents) / 10_000
  // ≤20% → 100, ≥100% → 0, linear between.
  const score = clampScore((1 - (ratio - 0.2) / 0.8) * 100)
  let interpretation = 'Manageable'
  if (ratio > 0.4) interpretation = 'Elevated'
  if (ratio > 0.7) interpretation = 'Heavy'
  return { score: round1(score), raw: `${round1(ratio * 100)}%`, interpretation }
}

export async function scoreBudgetAdherence(
  userId: string,
  asOf: Date,
): Promise<{ score: number | null; raw: string | null; interpretation: string }> {
  const active = await getDatabase()
    .select()
    .from(budgets)
    .where(and(eq(budgets.userId, userId), eq(budgets.isArchived, false)))
  if (active.length === 0) {
    return { score: null, raw: null, interpretation: 'No active budgets' }
  }
  let budgetedCents = 0n
  let overspendCents = 0n
  for (const budget of active) {
    const window = computeBudgetWindow(
      budget.period as Parameters<typeof computeBudgetWindow>[0],
      budget.startDate,
      budget.endDate,
      asOf,
    )
    const items = await getDatabase()
      .select({ categoryId: budgetItems.categoryId, amount: budgetItems.amount })
      .from(budgetItems)
      .where(eq(budgetItems.budgetId, budget.id))
    if (items.length === 0) continue
    const spent = await spentTotalsByCategory(
      userId,
      window.start,
      window.end,
      items.map((i) => i.categoryId),
    )
    for (const item of items) {
      const amount = toCents(item.amount)
      const used = spent.get(item.categoryId) ?? 0n
      budgetedCents += amount
      if (used > amount) overspendCents += used - amount
    }
  }
  if (budgetedCents <= 0n) {
    return { score: null, raw: null, interpretation: 'No budgeted amounts' }
  }
  const adherence = 1 - Number((overspendCents * 10_000n) / budgetedCents) / 10_000
  const percent = round1(adherence * 100)
  const score = clampScore(adherence * 100)
  let interpretation = 'Within budget'
  if (adherence < 0.85) interpretation = 'Overspending'
  if (adherence < 0.6) interpretation = 'Well over budget'
  return { score: round1(score), raw: `${percent}%`, interpretation }
}

/* ---------------------------------- result ---------------------------------- */

export function overallStatus(score: number | null): HealthResult['status'] {
  if (score === null) return 'insufficient-data'
  if (score >= 80) return 'excellent'
  if (score >= 60) return 'good'
  if (score >= 40) return 'fair'
  return 'poor'
}

export function weightedScore(components: HealthComponent[]): number | null {
  let total = 0
  let weightSum = 0
  for (const component of components) {
    if (component.score === null) continue
    total += component.score * component.weight
    weightSum += component.weight
  }
  if (weightSum === 0) return null
  return round1(total / weightSum)
}

export async function computeHealthScore(userId: string, asOf: Date = new Date()): Promise<HealthResult> {
  const windowFrom = daysAgo(asOf, 90)
  const windowTo = nextDayUtc(asOf)
  const series = await monthlySeries(userId, asOf, 12)

  const savings = scoreSavingsRate(series)
  const stability = scoreExpenseStability(series)
  const emergency = await scoreEmergencyFund(userId, asOf, series)
  const debt = await scoreDebtRatio(userId, windowFrom, windowTo)
  const adherence = await scoreBudgetAdherence(userId, asOf)

  const components: HealthComponent[] = [
    {
      key: 'savingsRate',
      label: 'Savings Rate',
      weight: COMPONENT_WEIGHTS.savingsRate,
      score: savings.score,
      raw: savings.raw,
      interpretation: savings.interpretation,
    },
    {
      key: 'expenseStability',
      label: 'Expense Stability',
      weight: COMPONENT_WEIGHTS.expenseStability,
      score: stability.score,
      raw: stability.raw,
      interpretation: stability.interpretation,
    },
    {
      key: 'emergencyFund',
      label: 'Emergency Fund',
      weight: COMPONENT_WEIGHTS.emergencyFund,
      score: emergency.score,
      raw: emergency.raw,
      interpretation: emergency.interpretation,
    },
    {
      key: 'debtRatio',
      label: 'Debt Ratio',
      weight: COMPONENT_WEIGHTS.debtRatio,
      score: debt.score,
      raw: debt.raw,
      interpretation: debt.interpretation,
    },
    {
      key: 'budgetAdherence',
      label: 'Budget Adherence',
      weight: COMPONENT_WEIGHTS.budgetAdherence,
      score: adherence.score,
      raw: adherence.raw,
      interpretation: adherence.interpretation,
    },
  ]

  const score = weightedScore(components)
  return {
    asOf: startOfDayUtc(asOf).toISOString(),
    score,
    status: overallStatus(score),
    components,
    unavailableComponents: components.filter((c) => c.score === null).map((c) => c.key),
  }
}
