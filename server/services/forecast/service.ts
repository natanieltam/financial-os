import { and, eq } from 'drizzle-orm'
import { getDatabase } from '../../../db/client'
import { recurringTransactions, bills } from '../../../db/schema/index'
import type { RecurringFrequency } from '../../../shared/constants/finance'
import { accountBalances, incomeExpenseWindow, daysAgo, startOfDayUtc, nextDayUtc } from '../analytics/metrics'
import { moneyToCents } from '../../../shared/money'
import { occurrenceDate } from '../recurring/service'
import { projectForecast, type ForecastProjection } from './projection'

/**
 * Deterministic cashflow forecasting (Phase 16, PRD §36). Every number here
 * is computed server-side from real data — the AI layer may only EXPLAIN
 * these outputs later; it never calculates a forecast (golden rule 4).
 */

export interface ForecastPayload {
  days: number
  asOf: string
  startingBalance: string
  recurring: { incomeTotal: string; expenseTotal: string; templateCount: number }
  bills: { total: string; count: number }
  baselineDailyExpense: string | null
  projection: ForecastProjection
}

function centsToString(cents: bigint): string {
  const neg = cents < 0n
  const abs = neg ? -cents : cents
  return `${neg ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`
}

/** Round-half-up division for exact BigInt cents (no floats). */
function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('denominator must be positive')
  const neg = numerator < 0n
  const n = neg ? -numerator : numerator
  const q = (n * 2n + denominator) / (denominator * 2n)
  return neg ? -q : q
}

function dateOnly(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`)
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export async function computeForecast(userId: string, days: number, asOf: Date = new Date()): Promise<ForecastPayload> {
  const today = startOfDayUtc(asOf)
  const todayIso = isoDay(today)
  const windowEnd = dateOnly(todayIso)
  windowEnd.setUTCDate(windowEnd.getUTCDate() + days)

  // 1. Starting balance from live account balances (derived, never stored).
  const balances = await accountBalances(userId)
  let startingCents = 0n
  for (const b of balances) startingCents += moneyToCents(b.balance)

  // 2. Recurring templates -> occurrences inside the window (overdue included).
  const templates = await getDatabase()
    .select()
    .from(recurringTransactions)
    .where(and(eq(recurringTransactions.userId, userId), eq(recurringTransactions.isActive, true)))

  const recurring: Array<{ amount: string; type: 'income' | 'expense'; occurrences: string[] }> = []
  for (const template of templates) {
    const occurrences: string[] = []
    // DATE column: plain 'YYYY-MM-DD' string; overdue occurrences land today.
    const cursorIso = template.nextDueDate < todayIso ? todayIso : template.nextDueDate
    let cursor = dateOnly(cursorIso)
    let guard = 0
    while (cursor.getTime() <= windowEnd.getTime() && guard < days + 5) {
      if (template.endDate && isoDay(cursor) > template.endDate) break // string dates compare lexicographically
      occurrences.push(isoDay(cursor))
      cursor = occurrenceDate(cursor, template.frequency as RecurringFrequency, 1)
      guard++
    }
    recurring.push({
      amount: template.amount,
      type: template.type as 'income' | 'expense',
      occurrences,
    })
  }

  // 3. Unpaid bills due inside the window (overdue bills are counted today).
  const billRows = await getDatabase()
    .select()
    .from(bills)
    .where(eq(bills.userId, userId))
  const billInputs = billRows
    .filter((b) => !b.paidAt && b.status !== 'paid' && dateOnly(b.dueDate).getTime() <= windowEnd.getTime())
    .map((b) => ({
      amount: b.amount,
      dueDate: (b.dueDate < todayIso ? todayIso : b.dueDate) as string,
    }))

  // 4. Baseline discretionary spend: avg daily expense over 90 days minus the
  //    recurring daily load (so recurring is never double counted).
  const historyFrom = daysAgo(today, 90)
  const history = await incomeExpenseWindow(userId, historyFrom, nextDayUtc(today))
  const historyDays = 90
  const expense90 = moneyToCents(history.expense)
  let recurringDaily = 0n
  for (const item of recurring) {
    recurringDaily += divRound(moneyToCents(item.amount) * BigInt(item.occurrences.length), BigInt(days))
  }
  const avgDaily = divRound(expense90, BigInt(historyDays))
  const baselineCents = avgDaily > recurringDaily ? avgDaily - recurringDaily : 0n
  const hasHistory = expense90 > 0n
  const baselineDailyExpense = hasHistory ? centsToString(baselineCents) : null

  const projection = projectForecast({
    startingBalance: centsToString(startingCents),
    recurring,
    bills: billInputs,
    baselineDailyExpense,
    days,
    asOf: todayIso,
  })

  let incomeTotal = 0n
  let expenseTotal = 0n
  for (const item of recurring) {
    for (const _ of item.occurrences) {
      if (item.type === 'income') incomeTotal += moneyToCents(item.amount)
      else expenseTotal += moneyToCents(item.amount)
    }
  }
  let billsTotal = 0n
  for (const b of billInputs) billsTotal += moneyToCents(b.amount)

  return {
    days,
    asOf: todayIso,
    startingBalance: centsToString(startingCents),
    recurring: {
      incomeTotal: centsToString(incomeTotal),
      expenseTotal: centsToString(expenseTotal),
      templateCount: templates.length,
    },
    bills: { total: centsToString(billsTotal), count: billInputs.length },
    baselineDailyExpense,
    projection,
  }
}
