/**
 * Precise money primitives (PRD §17, golden rule 6).
 * Monetary values are decimal STRINGS ("1234.56"); arithmetic happens on
 * BigInt cents or in PostgreSQL NUMERIC — never IEEE-754 floats.
 */

/** Canonical decimal: optional "-", integer part, optional 1–2 decimals. */
const MONEY_PATTERN = /^-?(0|[1-9]\d{0,17})(\.\d{1,2})?$/

export class MoneyError extends Error {}

/** Normalize/validate a client-supplied amount into canonical decimal form. */
export function normalizeMoney(input: string | number): string {
  let raw: string
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || Math.abs(input) >= 1e15) {
      throw new MoneyError('Invalid amount')
    }
    // Formatting only (input normalization) — no arithmetic on this value.
    raw = input.toFixed(2)
  } else {
    raw = input.trim()
  }
  if (!MONEY_PATTERN.test(raw)) {
    throw new MoneyError('Amount must be a decimal number with at most 2 decimal places')
  }
  return raw
}

/** True when the amount is a valid money string strictly greater than zero. */
export function isPositiveMoney(input: string | number): boolean {
  try {
    return moneyToCents(normalizeMoney(input)) > 0n
  } catch {
    return false
  }
}

export function moneyToCents(money: string): bigint {
  const negative = money.startsWith('-')
  const body = negative ? money.slice(1) : money
  const [intPart = '0', fracPart = '0'] = body.split('.')
  const cents = BigInt(intPart) * 100n + BigInt(fracPart.padEnd(2, '0').slice(0, 2))
  return negative ? -cents : cents
}

export function centsToMoney(cents: bigint): string {
  const negative = cents < 0n
  const abs = negative ? -cents : cents
  const whole = abs / 100n
  const frac = (abs % 100n).toString().padStart(2, '0')
  return `${negative ? '-' : ''}${whole}.${frac}`
}

export function addMoney(a: string, b: string): string {
  return centsToMoney(moneyToCents(a) + moneyToCents(b))
}

export function subMoney(a: string, b: string): string {
  return centsToMoney(moneyToCents(a) - moneyToCents(b))
}

export function cmpMoney(a: string, b: string): -1 | 0 | 1 {
  const ca = moneyToCents(a)
  const cb = moneyToCents(b)
  return ca < cb ? -1 : ca > cb ? 1 : 0
}

/** Percentage (0–100, 2 decimals) of part/whole computed on BigInts. */
export function percentOf(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0
  const scaled = (part * 10_000n) / whole
  return Number(scaled) / 100
}

/** Group digits the id-ID way: 1234567.89 -> 1.234.567,89 (integer grouping). */
function groupInteger(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** Display-only formatting — no math, exact digits from the decimal string. */
export function formatAmount(money: string, opts: { decimals?: number } = {}): string {
  const negative = money.startsWith('-')
  const body = negative ? money.slice(1) : money
  const [intPart = '0', fracPart = ''] = body.split('.')
  const decimals = opts.decimals ?? 2
  const frac = decimals > 0 ? `,${fracPart.padEnd(decimals, '0').slice(0, decimals)}` : ''
  return `${negative ? '-' : ''}${groupInteger(intPart)}${frac}`
}

export function formatMoney(money: string, currency = 'IDR'): string {
  const formatted = formatAmount(money)
  if (currency === 'IDR') return `Rp${formatted}`
  return `${formatted} ${currency.toUpperCase()}`
}
