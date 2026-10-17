import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDatabase } from '../../../db/client'
import { fundNavHistory, mutualFunds } from '../../../db/schema/index'
import { parseCsvWithHeader } from './csv'

/**
 * `db.execute()` with the node-postgres driver returns a pg `Result` object
 * (rows live under `.rows`), not a bare array. This unwraps it so callers can
 * iterate rows directly.
 */
async function execRows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await getDatabase().execute(query)) as unknown
  if (Array.isArray(result)) return result as T[]
  const rows = (result as { rows?: unknown }).rows
  return Array.isArray(rows) ? (rows as T[]) : []
}

/**
 * Mutual fund data layer.
 *
 * Source: the free `bibit-reksadana` dataset on GitHub (mirrors OJK/Bibit/
 * Bareksa listings, refreshed daily by an Action). Two files are used:
 *   - `data/funds.csv`            — one row per fund product (4.5k rows)
 *   - `data/bibit/nav/{id}.csv`   — daily NAV history per tradable fund
 *
 * The master CSV carries NO performance numbers, so every return figure this
 * module exposes is computed from `fund_nav_history` at read time. Nothing is
 * stored that could drift away from the NAV rows it claims to summarise.
 */

const FUNDS_CSV_URL = 'https://raw.githubusercontent.com/risan/bibit-reksadana/main/data/funds.csv'
const NAV_CSV_URL = (bibitId: string) =>
  `https://raw.githubusercontent.com/risan/bibit-reksadana/main/data/bibit/nav/${bibitId}.csv`

/** Canonical fund types. Upstream labels are free-form, so they are mapped here. */
export const FUND_TYPES = [
  'Pasar Uang',
  'Obligasi',
  'Saham',
  'Campuran',
  'Terproteksi',
  'Reksadana Global',
  'Dana Investasi Real Estate',
  'Penyertaan Terbatas',
  'ETF',
  'DPLK',
  'Lainnya',
] as const

export type FundType = (typeof FUND_TYPES)[number]

/** Upstream `type` string -> canonical bucket. Unmapped/empty -> 'Lainnya'. */
export function normalizeFundType(raw: string | null | undefined): FundType {
  const value = (raw ?? '').trim()
  if (!value) return 'Lainnya'
  const exact = FUND_TYPES.find((t) => t.toLowerCase() === value.toLowerCase())
  if (exact) return exact
  const lower = value.toLowerCase()
  if (lower.includes('pasar uang') || lower.includes('money market')) return 'Pasar Uang'
  if (lower.includes('real estate') || lower.includes('dire')) return 'Dana Investasi Real Estate'
  if (lower.includes('terproteksi') || lower.includes('protected')) return 'Terproteksi'
  if (lower.includes('penyertaan terbatas')) return 'Penyertaan Terbatas'
  if (lower.includes('global') || lower.includes('internasional')) return 'Reksadana Global'
  if (lower.includes('etf') || lower.includes('exchange traded')) return 'ETF'
  if (lower.includes('dplk') || lower.includes('pensiun')) return 'DPLK'
  if (lower.includes('obligasi') || lower.includes('pendapatan tetap') || lower.includes('bond')) {
    return 'Obligasi'
  }
  if (lower.includes('saham') || lower.includes('equity')) return 'Saham'
  if (lower.includes('campuran') || lower.includes('mixed')) return 'Campuran'
  return 'Lainnya'
}

export type FundListQuery = {
  type?: string
  currency?: string
  sharia?: 'true' | 'false'
  tradable?: 'true' | 'false'
  search?: string
  /** Sort key; defaults to fund name. */
  sort?: 'name' | 'nav' | 'return1d' | 'return1m' | 'return1y' | 'returnInception'
  limit?: number
  offset?: number
}

/** Returns per period in percent (4.21 means +4.21%). Null when NAV is missing. */
export type FundReturns = {
  day1: number | null
  week1: number | null
  month1: number | null
  month3: number | null
  month6: number | null
  ytd: number | null
  year1: number | null
  year3: number | null
  year5: number | null
  inception: number | null
}

export type FundListItem = {
  id: string
  code: string
  bibitId: string | null
  name: string
  manager: string | null
  type: string
  currency: string
  sharia: boolean
  launchDate: string | null
  isTradable: boolean
  latestNav: number | null
  latestNavDate: string | null
  navRows: number
  returns: FundReturns
}

type NavAnchorRow = {
  id: string
  code: string
  bibit_id: string | null
  name: string
  manager: string | null
  type: string
  currency: string
  sharia: string
  launch_date: string | null
  is_tradable: string
  nav_rows: number
  latest_nav: string | null
  latest_nav_date: string | null
  latest_adj: string | null
  nav_1d: string | null
  nav_1w: string | null
  nav_1m: string | null
  nav_3m: string | null
  nav_6m: string | null
  nav_ytd: string | null
  nav_1y: string | null
  nav_3y: string | null
  nav_5y: string | null
  nav_inception: string | null
}

/** Percent change between two NAV readings; null when either side is unusable. */
function pctChange(latest: number | null, past: number | null): number | null {
  if (latest === null || past === null) return null
  if (!Number.isFinite(latest) || !Number.isFinite(past)) return null
  if (past <= 0) return null
  return ((latest - past) / past) * 100
}

function toNum(value: string | null): number | null {
  if (value === null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function toIso(value: string | null): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * One query returning each fund plus its NAV anchors.
 *
 * A `LEFT JOIN LATERAL` per period replaces the N+1 queries a naive
 * implementation would need: each anchor is a single backwards index scan on
 * (fund_id, date) that stops at the first matching row. `nav_adjusted`
 * (dividend-reinvested) is preferred over the quoted `nav` because it reflects
 * what an investor actually earned.
 */
async function selectFundsWithReturns(
  where: ReturnType<typeof sql>,
  sort: FundListQuery['sort'],
  limit: number,
  offset: number,
) {
  const anchor = (alias: string, condition: string) => `
    LEFT JOIN LATERAL (
      SELECT COALESCE(h.nav_adjusted, h.nav) AS v
      FROM fund_nav_history h
      WHERE h.fund_id = f.id AND ${condition}
      ORDER BY h.date DESC
      LIMIT 1
    ) ${alias} ON true`

  const orderBy = {
    name: 'f.name ASC',
    nav: 'l.nav DESC NULLS LAST',
    return1d: 'CASE WHEN p1d.v IS NULL THEN NULL ELSE l.v / p1d.v END DESC NULLS LAST',
    return1m: 'CASE WHEN p1m.v IS NULL THEN NULL ELSE l.v / p1m.v END DESC NULLS LAST',
    return1y: 'CASE WHEN p1y.v IS NULL THEN NULL ELSE l.v / p1y.v END DESC NULLS LAST',
    returnInception: 'CASE WHEN pinc.v IS NULL THEN NULL ELSE l.v / pinc.v END DESC NULLS LAST',
  }[sort ?? 'name']

  const rows = await execRows<NavAnchorRow>(sql`
    SELECT
      f.id, f.code, f.bibit_id, f.name, f.manager, f.type, f.currency, f.sharia,
      f.launch_date, f.is_tradable, f.nav_rows,
      l.nav AS latest_nav, l.date AS latest_nav_date, l.v AS latest_adj,
      p1d.v AS nav_1d, p1w.v AS nav_1w, p1m.v AS nav_1m, p3m.v AS nav_3m,
      p6m.v AS nav_6m, pytd.v AS nav_ytd, p1y.v AS nav_1y, p3y.v AS nav_3y,
      p5y.v AS nav_5y, pinc.v AS nav_inception
    FROM mutual_funds f
    LEFT JOIN LATERAL (
      SELECT h.nav, h.date, COALESCE(h.nav_adjusted, h.nav) AS v
      FROM fund_nav_history h
      WHERE h.fund_id = f.id
      ORDER BY h.date DESC
      LIMIT 1
    ) l ON true
    ${sql.raw(anchor('p1d', "h.date <= l.date - interval '1 day'"))}
    ${sql.raw(anchor('p1w', "h.date <= l.date - interval '7 days'"))}
    ${sql.raw(anchor('p1m', "h.date <= l.date - interval '1 month'"))}
    ${sql.raw(anchor('p3m', "h.date <= l.date - interval '3 months'"))}
    ${sql.raw(anchor('p6m', "h.date <= l.date - interval '6 months'"))}
    ${sql.raw(anchor('pytd', "h.date < date_trunc('year', l.date)"))}
    ${sql.raw(anchor('p1y', "h.date <= l.date - interval '1 year'"))}
    ${sql.raw(anchor('p3y', "h.date <= l.date - interval '3 years'"))}
    ${sql.raw(anchor('p5y', "h.date <= l.date - interval '5 years'"))}
    LEFT JOIN LATERAL (
      SELECT COALESCE(h.nav_adjusted, h.nav) AS v
      FROM fund_nav_history h
      WHERE h.fund_id = f.id
      ORDER BY h.date ASC
      LIMIT 1
    ) pinc ON true
    WHERE ${where}
    ORDER BY ${sql.raw(orderBy)}
    LIMIT ${limit} OFFSET ${offset}
  `)

  return rows.map((row): FundListItem => {
    const latest = toNum(row.latest_adj)
    return {
      id: row.id,
      code: row.code,
      bibitId: row.bibit_id,
      name: row.name,
      manager: row.manager,
      type: row.type,
      currency: row.currency,
      sharia: row.sharia === 'true',
      launchDate: toIso(row.launch_date),
      isTradable: row.is_tradable === 'true',
      latestNav: toNum(row.latest_nav),
      latestNavDate: toIso(row.latest_nav_date),
      navRows: row.nav_rows,
      returns: {
        day1: pctChange(latest, toNum(row.nav_1d)),
        week1: pctChange(latest, toNum(row.nav_1w)),
        month1: pctChange(latest, toNum(row.nav_1m)),
        month3: pctChange(latest, toNum(row.nav_3m)),
        month6: pctChange(latest, toNum(row.nav_6m)),
        ytd: pctChange(latest, toNum(row.nav_ytd)),
        year1: pctChange(latest, toNum(row.nav_1y)),
        year3: pctChange(latest, toNum(row.nav_3y)),
        year5: pctChange(latest, toNum(row.nav_5y)),
        inception: pctChange(latest, toNum(row.nav_inception)),
      },
    }
  })
}

export async function listFunds(query: FundListQuery = {}) {
  const conditions = [sql`true`]
  if (query.type) conditions.push(sql`f.type = ${query.type}`)
  if (query.currency) conditions.push(sql`f.currency = ${query.currency}`)
  if (query.sharia) conditions.push(sql`f.sharia = ${query.sharia}`)
  if (query.tradable) conditions.push(sql`f.is_tradable = ${query.tradable}`)
  if (query.search) {
    const like = `%${query.search}%`
    conditions.push(sql`(f.name ILIKE ${like} OR f.manager ILIKE ${like} OR f.code ILIKE ${like})`)
  }
  const where = sql.join(conditions, sql` AND `)

  const limit = Math.min(query.limit ?? 50, 200)
  const offset = query.offset ?? 0

  const [funds, totalRows] = await Promise.all([
    selectFundsWithReturns(where, query.sort, limit, offset),
    execRows<{ count: number }>(sql`SELECT count(*)::int AS count FROM mutual_funds f WHERE ${where}`),
  ])

  return {
    funds,
    total: Number(totalRows[0]?.count ?? 0),
    limit,
    offset,
  }
}

export async function getFundById(id: string) {
  const [fund] = await selectFundsWithReturns(sql`f.id = ${id}`, undefined, 1, 0)
  return fund ?? null
}

/** Daily NAV series, oldest first — the shape a sparkline wants. */
export async function getFundNavSeries(fundId: string, days = 365) {
  const rows = await execRows<{ date: string; nav: string; nav_adjusted: string | null }>(sql`
    SELECT date, nav, nav_adjusted
    FROM fund_nav_history
    WHERE fund_id = ${fundId}
      AND date >= (SELECT max(date) FROM fund_nav_history WHERE fund_id = ${fundId})
                  - (${days} * interval '1 day')
    ORDER BY date ASC
  `)

  return rows.map((r) => ({
    date: toIso(r.date),
    nav: toNum(r.nav),
    navAdjusted: toNum(r.nav_adjusted),
  }))
}

/** Aggregate counters for the page header. */
export async function getFundStats() {
  const rows = await execRows<{
    funds: number
    tradable: number
    sharia: number
    money_market: number
    with_nav: number
    last_synced_at: string | null
    nav_rows: string
    latest_date: string | null
  }>(sql`
    SELECT
      count(*)::int AS funds,
      count(*) FILTER (WHERE is_tradable = 'true')::int AS tradable,
      count(*) FILTER (WHERE sharia = 'true')::int AS sharia,
      count(*) FILTER (WHERE type = 'Pasar Uang')::int AS money_market,
      count(*) FILTER (WHERE nav_rows > 0)::int AS with_nav,
      max(last_synced_at) AS last_synced_at,
      (SELECT count(*)::bigint FROM fund_nav_history) AS nav_rows,
      (SELECT max(date) FROM fund_nav_history) AS latest_date
    FROM mutual_funds
  `)

  const r = rows[0]
  return {
    funds: r?.funds ?? 0,
    tradable: r?.tradable ?? 0,
    sharia: r?.sharia ?? 0,
    moneyMarket: r?.money_market ?? 0,
    withNav: r?.with_nav ?? 0,
    navRows: Number(r?.nav_rows ?? 0),
    lastSyncedAt: toIso(r?.last_synced_at ?? null),
    latestDate: toIso(r?.latest_date ?? null),
  }
}

export async function getMoneyMarketFunds(limit = 100) {
  return listFunds({ type: 'Pasar Uang', sort: 'return1y', limit })
}

export type SyncStats = {
  fundsTotal: number
  fundsUpserted: number
  navFundsRequested: number
  navFundsSynced: number
  navRowsWritten: number
  durationMs: number
  errors: string[]
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split('/').slice(-1)[0]}`)
  return res.text()
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index]!)
    }
  })
  await Promise.all(workers)
  return results
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Sync fund master data and NAV history.
 *
 * Master data is upserted on `code` (the stable upstream id) in batched
 * statements — never row-by-row, which is what made the first attempt crawl
 * and then fail on the mis-parsed CSV.
 *
 * NAV history is fetched only for funds that have a Bibit feed, and only for
 * the requested types (default: money market) so one sync stays bounded. Rows
 * are written in 1000-row batches with an upsert on (fund_id, date), making
 * re-runs idempotent.
 */
export async function syncMutualFunds(
  options: { types?: string[]; maxFunds?: number } = {},
): Promise<SyncStats> {
  const startedAt = Date.now()
  const stats: SyncStats = {
    fundsTotal: 0,
    fundsUpserted: 0,
    navFundsRequested: 0,
    navFundsSynced: 0,
    navRowsWritten: 0,
    durationMs: 0,
    errors: [],
  }
  const db = getDatabase()

  // ---- 1. Master data ------------------------------------------------------
  const csv = await fetchText(FUNDS_CSV_URL)
  const records = parseCsvWithHeader(csv)
  stats.fundsTotal = records.length

  const values = records
    .filter((r) => (r.id ?? '').trim() && (r.name ?? '').trim())
    .map((r) => {
      const launch = (r.launch_date ?? '').trim()
      // Upstream uses 1970-01-01 as an "unknown" sentinel — store null instead.
      const parsedLaunch = launch && !launch.startsWith('1970-01-01') ? new Date(launch) : null
      const launchDate =
        parsedLaunch && !Number.isNaN(parsedLaunch.getTime()) ? parsedLaunch : null
      return {
        code: r.id!.trim(),
        bibitId: (r.bibit ?? '').trim() || null,
        bareksaId: (r.bareksa ?? '').trim() || null,
        kontanId: (r.kontan ?? '').trim() || null,
        makmurId: (r.makmur ?? '').trim() || null,
        ojkName: (r.ojk ?? '').trim() || null,
        name: r.name!.trim(),
        otherNames: (r.other_names ?? '').trim() || null,
        manager: (r.manager ?? '').trim() || null,
        type: normalizeFundType(r.type),
        currency: (r.currency ?? '').trim() || 'IDR',
        sharia: (r.sharia ?? '').trim() === 'true' ? 'true' : 'false',
        launchDate,
        isTradable: (r.bibit ?? '').trim() ? 'true' : 'false',
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      }
    })

  for (const batch of chunk(values, 500)) {
    try {
      await db
        .insert(mutualFunds)
        .values(batch)
        .onConflictDoUpdate({
          target: mutualFunds.code,
          set: {
            bibitId: sql`excluded.bibit_id`,
            bareksaId: sql`excluded.bareksa_id`,
            kontanId: sql`excluded.kontan_id`,
            makmurId: sql`excluded.makmur_id`,
            ojkName: sql`excluded.ojk_name`,
            name: sql`excluded.name`,
            otherNames: sql`excluded.other_names`,
            manager: sql`excluded.manager`,
            type: sql`excluded.type`,
            currency: sql`excluded.currency`,
            sharia: sql`excluded.sharia`,
            launchDate: sql`excluded.launch_date`,
            isTradable: sql`excluded.is_tradable`,
            lastSyncedAt: sql`excluded.last_synced_at`,
            updatedAt: sql`excluded.updated_at`,
          },
        })
      stats.fundsUpserted += batch.length
    } catch (e) {
      stats.errors.push(
        `Funds batch @${stats.fundsUpserted}: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  // ---- 2. NAV history ------------------------------------------------------
  const types = options.types?.length ? options.types : ['Pasar Uang']
  const targets = (await db
    .select({ id: mutualFunds.id, bibitId: mutualFunds.bibitId })
    .from(mutualFunds)
    .where(and(inArray(mutualFunds.type, types), eq(mutualFunds.isTradable, 'true')))) as {
    id: string
    bibitId: string | null
  }[]

  const limited = options.maxFunds ? targets.slice(0, options.maxFunds) : targets
  stats.navFundsRequested = limited.length

  await mapLimit(limited, 8, async (fund) => {
    if (!fund.bibitId) return
    try {
      const navCsv = await fetchText(NAV_CSV_URL(fund.bibitId))
      const navRecords = parseCsvWithHeader(navCsv)
      if (navRecords.length === 0) return

      const rows: { fundId: string; date: Date; nav: string; navAdjusted: string | null }[] = []
      let latestDate: Date | null = null
      let latestNav: string | null = null

      for (const record of navRecords) {
        const rawDate = (record.date ?? '').trim()
        const rawNav = (record.nav ?? '').trim()
        if (!rawDate || !rawNav) continue
        const date = new Date(rawDate)
        if (Number.isNaN(date.getTime()) || !Number.isFinite(Number(rawNav))) continue

        const adjustedRaw = (record.nav_adjusted ?? '').trim()
        const adjusted = adjustedRaw && Number.isFinite(Number(adjustedRaw)) ? adjustedRaw : null

        rows.push({ fundId: fund.id, date, nav: rawNav, navAdjusted: adjusted })
        if (!latestDate || date > latestDate) {
          latestDate = date
          latestNav = rawNav
        }
      }
      if (rows.length === 0) return

      for (const batch of chunk(rows, 1000)) {
        await db
          .insert(fundNavHistory)
          .values(batch)
          .onConflictDoUpdate({
            target: [fundNavHistory.fundId, fundNavHistory.date],
            set: { nav: sql`excluded.nav`, navAdjusted: sql`excluded.nav_adjusted` },
          })
        stats.navRowsWritten += batch.length
      }

      await db
        .update(mutualFunds)
        .set({
          latestNav,
          latestNavDate: latestDate,
          navRows: rows.length,
          updatedAt: new Date(),
        })
        .where(eq(mutualFunds.id, fund.id))

      stats.navFundsSynced++
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      // A missing NAV file is normal (delisted/renamed fund), not worth reporting.
      if (!message.includes('HTTP 404')) stats.errors.push(`NAV ${fund.bibitId}: ${message}`)
    }
  })

  stats.durationMs = Date.now() - startedAt
  return stats
}
