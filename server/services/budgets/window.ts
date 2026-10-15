import type { BudgetPeriod } from '../../../shared/constants/finance'

/**
 * Deterministic budget windows (PRD §29–§30).
 * A budget with endDate is a fixed range; without endDate it repeats in
 * period-sized windows anchored to startDate.
 */

export interface BudgetWindow {
  start: Date
  /** Exclusive upper bound. */
  end: Date
}

function utc(y: number, m: number, d: number): number {
  return Date.UTC(y, m, d)
}

/** startDate + n months, clamping the day for shorter months (e.g. 31 → 30). */
function addMonths(y: number, m: number, d: number, n: number): Date {
  const probe = new Date(Date.UTC(y, m + n, 1))
  const lastDay = new Date(Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth(), Math.min(d, lastDay)))
}

/** startDate + n periods, clamping the day for shorter months. */
export function addPeriods(start: Date, period: BudgetPeriod, n: number): Date {
  const y = start.getUTCFullYear()
  const m = start.getUTCMonth()
  const d = start.getUTCDate()
  if (period === 'weekly') {
    return new Date(utc(y, m, d) + n * 7 * 86_400_000)
  }
  if (period === 'yearly') {
    return addMonths(y, m, d, n * 12)
  }
  return addMonths(y, m, d, n)
}

function dayMs(n: number): number {
  return n * 86_400_000
}

/**
 * Window containing `asOf` for the given budget definition.
 * Weekly windows are 7-day spans from startDate; monthly/yearly windows step
 * calendar periods anchored at startDate (day clamped).
 */
export function computeBudgetWindow(
  period: BudgetPeriod,
  startDate: string,
  endDate: string | null,
  asOf: Date,
): BudgetWindow {
  const start0 = new Date(`${startDate}T00:00:00.000Z`)
  if (endDate) {
    const end = new Date(`${endDate}T00:00:00.000Z`)
    end.setUTCDate(end.getUTCDate() + 1) // inclusive endDate → exclusive bound
    return { start: start0, end }
  }
  // Rolling windows: find k where boundary_k <= asOf < boundary_{k+1}.
  let k = 0
  let guard = 0
  for (;;) {
    const next =
      period === 'weekly'
        ? new Date(start0.getTime() + dayMs(7 * (k + 1)))
        : addPeriods(start0, period, k + 1)
    if (next.getTime() > asOf.getTime() || guard++ > 2400) break
    k++
  }
  const start =
    period === 'weekly'
      ? new Date(start0.getTime() + dayMs(7 * k))
      : addPeriods(start0, period, k)
  const end =
    period === 'weekly'
      ? new Date(start0.getTime() + dayMs(7 * (k + 1)))
      : addPeriods(start0, period, k + 1)
  return { start, end }
}

export const WARNING_THRESHOLD = 0.75 // central rule (PRD §29 status semantics)

export type BudgetItemStatus = 'healthy' | 'warning' | 'exceeded'

/** Status of one budget line: <75% healthy, 75–100% warning, >100% exceeded. */
export function budgetItemStatus(
  spentCents: bigint,
  amountCents: bigint,
): BudgetItemStatus {
  if (amountCents <= 0n) return spentCents > 0n ? 'exceeded' : 'healthy'
  if (spentCents > amountCents) return 'exceeded'
  if (spentCents * 100n >= amountCents * BigInt(Math.round(WARNING_THRESHOLD * 100))) {
    return 'warning'
  }
  return 'healthy'
}

/** 0–100+ percent (2 decimals) of spent against budget, precise on BigInts. */
export function budgetPercent(spentCents: bigint, amountCents: bigint): number {
  if (amountCents <= 0n) return spentCents > 0n ? 100 : 0
  const scaled = (spentCents * 10_000n) / amountCents
  return Number(scaled) / 100
}
