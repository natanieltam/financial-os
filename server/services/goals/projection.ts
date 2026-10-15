/**
 * Goal what-if projection (PRD §31) — deterministic server-side math.
 * AI must NEVER compute this (PRD §8, golden rule 4).
 */

export interface ProjectionInput {
  targetCents: bigint
  currentCents: bigint
  monthlyContributionCents: bigint
  today: Date
  /** YYYY-MM-DD or null. */
  deadline: string | null
}

export interface ProjectionResult {
  remaining: string
  completed: boolean
  /** Whole months of contribution needed (ceil). */
  monthsNeeded: number
  /** YYYY-MM-DD estimate, null when already completed. */
  estimatedCompletion: string | null
  /** Monthly amount required to finish by the deadline, null if no deadline. */
  requiredMonthlyByDeadline: string | null
  /** Progress percent toward target (0–100, 2 decimals). */
  progressPercent: number
}

function toCents(money: string): bigint {
  const negative = money.startsWith('-')
  const body = negative ? money.slice(1) : money
  const [i = '0', f = '0'] = body.split('.')
  const cents = BigInt(i) * 100n + BigInt(f.padEnd(2, '0').slice(0, 2))
  return negative ? -cents : cents
}

export function centsToString(cents: bigint): string {
  const negative = cents < 0n
  const abs = negative ? -cents : cents
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`
}

export function moneyToCentsInput(money: string): bigint {
  return toCents(money)
}

function addCalendarMonths(base: Date, months: number): Date {
  const y = base.getUTCFullYear()
  const m = base.getUTCMonth()
  const d = base.getUTCDate()
  const probe = new Date(Date.UTC(y, m + months, 1))
  const lastDay = new Date(Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth(), Math.min(d, lastDay)))
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Calendar months (rounded up) between two UTC dates. */
function monthsBetween(from: Date, to: Date): number {
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth())
  if (to.getUTCDate() > from.getUTCDate()) return months + 1
  return Math.max(months, 0)
}

export function computeProjection(input: ProjectionInput): ProjectionResult {
  const { targetCents, currentCents, monthlyContributionCents, today, deadline } = input
  const achieved = currentCents >= targetCents ? targetCents : currentCents
  const remaining = targetCents - achieved
  const progressPercent =
    targetCents <= 0n
      ? 0
      : Number((achieved * 10_000n) / targetCents) / 100

  if (remaining <= 0n || targetCents <= 0n) {
    return {
      remaining: centsToString(0n),
      completed: true,
      monthsNeeded: 0,
      estimatedCompletion: null,
      requiredMonthlyByDeadline: centsToString(0n),
      progressPercent: 100,
    }
  }

  let monthsNeeded = 0
  let estimatedCompletion: string | null = null
  if (monthlyContributionCents > 0n) {
    monthsNeeded = Number((remaining + monthlyContributionCents - 1n) / monthlyContributionCents)
    estimatedCompletion = isoDate(addCalendarMonths(today, monthsNeeded))
  }

  let requiredMonthlyByDeadline: string | null = null
  if (deadline) {
    const deadlineDate = new Date(`${deadline}T00:00:00.000Z`)
    const monthsLeft = Math.max(1, monthsBetween(today, deadlineDate))
    const required = (remaining + BigInt(monthsLeft) - 1n) / BigInt(monthsLeft)
    requiredMonthlyByDeadline = centsToString(required)
  }

  return {
    remaining: centsToString(remaining),
    completed: false,
    monthsNeeded,
    estimatedCompletion,
    requiredMonthlyByDeadline,
    progressPercent,
  }
}
