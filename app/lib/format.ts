const idr = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const idrCents = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Format a server-provided decimal string (e.g. "12345678.90") as IDR. */
export function formatMoney(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '\u2014'
  const negative = value.startsWith('-')
  const raw = negative ? value.slice(1) : value
  const [whole, frac] = raw.split('.')
  const hasCents = frac !== undefined && frac !== '00' && frac !== '0'
  const asNumber = Number(whole)
  if (!Number.isFinite(asNumber)) return '\u2014'
  const formatted = hasCents ? idrCents.format(Number(raw)) : idr.format(asNumber)
  return negative ? `-${formatted}` : formatted
}

/** Compact IDR for chart axes: 12jt / 3,4jt / 500rb. */
export function formatMoneyCompact(value: string | number): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return '\u2014'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })}M`
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })}jt`
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toLocaleString('id-ID', { maximumFractionDigits: 0 })}rb`
  return `${sign}${abs.toLocaleString('id-ID')}`
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '\u2014'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '\u2014'
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '\u2014'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '\u2014'
  return d.toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '\u2014'
  return `${value.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`
}
