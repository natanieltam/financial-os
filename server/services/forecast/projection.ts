import { moneyToCents } from '../../../shared/money'

/**
 * Deterministic cashflow projection core (Phase 16, PRD §36). Pure functions
 * on BigInt cents — no floats, no AI, no database (golden rule 4/6).
 * All inputs are already authoritative, server-computed values.
 */

export interface ForecastRecurringInput {
  amount: string
  type: 'income' | 'expense'
  /** Dates (YYYY-MM-DD) on which this template fires inside the window. */
  occurrences: string[]
}

export interface ForecastBillInput {
  amount: string
  dueDate: string
}

export interface ForecastInput {
  startingBalance: string
  recurring: ForecastRecurringInput[]
  bills: ForecastBillInput[]
  /** Average discretionary (non-recurring) daily expense, or null with no history. */
  baselineDailyExpense: string | null
  days: number
  asOf: string // YYYY-MM-DD
}

export interface ForecastSeriesPoint {
  date: string
  balance: string
}

export interface ForecastProjection {
  recurringIncomeTotal: string
  recurringExpenseTotal: string
  billsTotal: string
  baselineTotal: string | null
  projectedEndBalance: string
  willBeNegative: boolean
  series: ForecastSeriesPoint[]
  assumptions: string[]
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function centsToMoney(cents: bigint): string {
  const neg = cents < 0n
  const abs = neg ? -cents : cents
  const whole = abs / 100n
  const frac = (abs % 100n).toString().padStart(2, '0')
  return `${neg ? '-' : ''}${whole}.${frac}`
}

/**
 * Projects the balance day by day: starting balance + recurring income -
 * recurring expenses - bills due - baseline discretionary spend (PRD §36).
 */
export function projectForecast(input: ForecastInput): ForecastProjection {
  const assumptions: string[] = []
  let balance = moneyToCents(input.startingBalance)

  const perDay = new Map<string, { income: bigint; expense: bigint }>()
  let recurringIncome = 0n
  let recurringExpense = 0n
  for (const item of input.recurring) {
    const cents = moneyToCents(item.amount)
    for (const date of item.occurrences) {
      const slot = perDay.get(date) ?? { income: 0n, expense: 0n }
      if (item.type === 'income') {
        slot.income += cents
        recurringIncome += cents
      } else {
        slot.expense += cents
        recurringExpense += cents
      }
      perDay.set(date, slot)
    }
  }
  let billsTotal = 0n
  for (const bill of input.bills) {
    const cents = moneyToCents(bill.amount)
    billsTotal += cents
    const slot = perDay.get(bill.dueDate) ?? { income: 0n, expense: 0n }
    slot.expense += cents
    perDay.set(bill.dueDate, slot)
  }

  const baselineDaily = input.baselineDailyExpense ? moneyToCents(input.baselineDailyExpense) : null
  if (baselineDaily === null) {
    assumptions.push('Belum ada cukup riwayat pengeluaran — forecast hanya memuat recurring + tagihan.')
  }

  // Items dated today (overdue recurring/bills clamped to asOf) move the
  // starting point immediately — otherwise they would silently never count.
  const todaySlot = perDay.get(input.asOf)
  if (todaySlot) balance += todaySlot.income - todaySlot.expense

  const series: ForecastSeriesPoint[] = [{ date: input.asOf, balance: centsToMoney(balance) }]
  let baselineTotal: string | null = null
  if (baselineDaily !== null) {
    let acc = 0n
    for (let i = 1; i <= input.days; i++) {
      acc += baselineDaily
    }
    baselineTotal = centsToMoney(acc)
    assumptions.push(
      `Pengeluaran harian rata-rata non-recurring ${centsToMoney(baselineDaily)}/hari (rata-rata 90 hari terakhir).`,
    )
  }
  assumptions.push('Recurring dihitung dari frekuensi aktif; tagihan dari due date yang belum dibayar.')
  assumptions.push('Forecast deterministik (server-side) — AI tidak menghitung angka forecast.')

  for (let i = 1; i <= input.days; i++) {
    const date = addDaysIso(input.asOf, i)
    const slot = perDay.get(date)
    if (slot) balance += slot.income - slot.expense
    if (baselineDaily !== null) balance -= baselineDaily
    series.push({ date, balance: centsToMoney(balance) })
  }

  return {
    recurringIncomeTotal: centsToMoney(recurringIncome),
    recurringExpenseTotal: centsToMoney(recurringExpense),
    billsTotal: centsToMoney(billsTotal),
    baselineTotal,
    projectedEndBalance: centsToMoney(balance),
    willBeNegative: balance < 0n,
    series,
    assumptions,
  }
}
