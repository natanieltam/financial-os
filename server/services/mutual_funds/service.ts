import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
} from 'drizzle-orm'
import { getDatabase } from '../../../db/client'
import { fundNavHistory, mutualFunds } from '../../../db/schema/index'

export type FundListQuery = {
  type?: string
  currency?: string
  sharia?: 'true' | 'false'
  tradable?: 'true' | 'false'
  search?: string
  limit?: number
  offset?: number
}

export type FundNavHistoryQuery = {
  fundId: string
  from?: Date
  to?: Date
  limit?: number
}

export async function listFunds(query: FundListQuery = {}) {
  const conditions = []
  if (query.type) conditions.push(eq(mutualFunds.type, query.type))
  if (query.currency) conditions.push(eq(mutualFunds.currency, query.currency))
  if (query.sharia) conditions.push(eq(mutualFunds.sharia, query.sharia))
  if (query.tradable) conditions.push(eq(mutualFunds.isTradable, query.tradable))
  if (query.search) {
    conditions.push(
      sql`(${mutualFunds.name} ILIKE ${`%${query.search}%`} OR ${mutualFunds.manager} ILIKE ${`%${query.search}%`})`,
    )
  }

  const limit = query.limit ?? 100
  const offset = query.offset ?? 0

  const [items, total] = await Promise.all([
    getDatabase()
      .select()
      .from(mutualFunds)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(mutualFunds.type, mutualFunds.name)
      .limit(limit)
      .offset(offset),
    getDatabase()
      .select({ count: sql<number>`count(*)` })
      .from(mutualFunds)
      .where(conditions.length ? and(...conditions) : undefined),
  ])

  return {
    funds: items,
    total: Number(total[0]?.count ?? 0),
  }
}

export async function getFundById(id: string) {
  const db = getDatabase()
  const fund = await db.select().from(mutualFunds).where(eq(mutualFunds.id, id)).limit(1)
  return fund[0] ?? null
}

export async function getFundByBibitId(bibitId: string) {
  const db = getDatabase()
  const fund = await db
    .select()
    .from(mutualFunds)
    .where(eq(mutualFunds.bibitId, bibitId))
    .limit(1)
  return fund[0] ?? null
}

export async function getFundNavHistory(query: FundNavHistoryQuery) {
  const db = getDatabase()
  const conditions = [eq(fundNavHistory.fundId, query.fundId)]
  if (query.from) conditions.push(gte(fundNavHistory.date, query.from))
  if (query.to) conditions.push(lte(fundNavHistory.date, query.to))

  const limit = query.limit ?? 500
  return db
    .select()
    .from(fundNavHistory)
    .where(and(...conditions))
    .orderBy(desc(fundNavHistory.date))
    .limit(limit)
}

export async function getLatestNavForFunds(fundIds: string[]) {
  if (fundIds.length === 0) return []
  const db = getDatabase()

  // Get latest NAV for each fund using lateral join (efficient)
  const result = await db
    .select({
      fundId: fundNavHistory.fundId,
      date: fundNavHistory.date,
      nav: fundNavHistory.nav,
      navAdjusted: fundNavHistory.navAdjusted,
    })
    .from(fundNavHistory)
    .where(
      and(
        inArray(fundNavHistory.fundId, fundIds),
        sql`${fundNavHistory.date} = (
          SELECT max(date) FROM fund_nav_history f2 WHERE f2.fund_id = ${fundNavHistory.fundId}
        )`,
      ),
    )

  return result
}

export async function getFundsWithLatestNav(query: FundListQuery = {}) {
  const { funds } = await listFunds({ ...query, limit: 1000 })
  const fundIds = funds.map((f) => f.id)
  const latestNavs = await getLatestNavForFunds(fundIds)

  const navMap = new Map(latestNavs.map((n) => [n.fundId, n]))

  return funds.map((fund) => ({
    ...fund,
    latestNav: navMap.get(fund.id)?.nav ?? fund.latestNav,
    latestNavDate: navMap.get(fund.id)?.date ?? fund.latestNavDate,
  }))
}

export async function getMoneyMarketFunds() {
  return listFunds({ type: 'Pasar Uang', limit: 100 })
}

export type SyncStats = {
  fundsTotal: number
  fundsUpdated: number
  fundsInserted: number
  navRowsTotal: number
  navRowsInserted: number
  errors: string[]
}

export async function syncMutualFunds(): Promise<SyncStats> {
  const stats: SyncStats = {
    fundsTotal: 0,
    fundsUpdated: 0,
    fundsInserted: 0,
    navRowsTotal: 0,
    navRowsInserted: 0,
    errors: [],
  }
  const db = getDatabase()

  try {
    // 1. Fetch funds CSV from GitHub
    const fundsCsvUrl = 'https://raw.githubusercontent.com/risan/bibit-reksadana/main/data/funds.csv'
    const fundsCsvResponse = await fetch(fundsCsvUrl)
    if (!fundsCsvResponse.ok) throw new Error(`Failed to fetch funds CSV: ${fundsCsvResponse.status}`)
    const fundsCsvText = await fundsCsvResponse.text()

    // Parse CSV (simple, no quotes/escaping in this CSV)
    const lines = fundsCsvText.trim().split('\n')
    const headers = (lines[0] ?? '').split(',')
    const fundsData = lines.slice(1).map((line) => {
      const cols = line.split(',')
      return Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? '']))
    })

    stats.fundsTotal = fundsData.length

    // 2. Upsert funds
    for (const row of fundsData) {
      try {
        const existing = await getFundByBibitId(row.bibit ?? '')
        const fundData = {
          bibitId: row.bibit || null,
          bareksaId: row.bareksa || null,
          kontanId: row.kontan || null,
          ojkName: row.ojk || null,
          name: row.name ?? '',
          otherNames: row.other_names || null,
          manager: row.manager ?? '',
          type: row.type ?? '',
          currency: row.currency || 'IDR',
          sharia: row.sharia || 'false',
          launchDate: row.launch_date ? new Date(row.launch_date) : null,
          isTradable: row.bibit ? 'true' : 'false',
          lastSyncedAt: new Date(),
        }

        if (existing) {
          await db
            .update(mutualFunds)
            .set({ ...fundData, updatedAt: new Date() })
            .where(eq(mutualFunds.id, existing.id))
          stats.fundsUpdated++
        } else {
          await db.insert(mutualFunds).values(fundData)
          stats.fundsInserted++
        }
      } catch (e) {
        stats.errors.push(`Fund ${row.bibit}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    // 3. Fetch NAV history for tradable funds only (Bibit has full history only for tradable)
    const tradableFunds = await db
      .select({ id: mutualFunds.id, bibitId: mutualFunds.bibitId })
      .from(mutualFunds)
      .where(eq(mutualFunds.isTradable, 'true'))

    for (const fund of tradableFunds) {
      if (!fund.bibitId) continue
      try {
        const navCsvUrl = `https://raw.githubusercontent.com/risan/bibit-reksadana/main/data/bibit/nav/${fund.bibitId}.csv`
        const navCsvResponse = await fetch(navCsvUrl)
        if (!navCsvResponse.ok) {
          if (navCsvResponse.status !== 404) {
            stats.errors.push(`NAV ${fund.bibitId}: HTTP ${navCsvResponse.status}`)
          }
          continue
        }
        const navCsvText = await navCsvResponse.text()
        const navLines = navCsvText.trim().split('\n')
        if (navLines.length <= 1) continue // Only header

        const navHeaders = (navLines[0] ?? '').split(',')
        const navData = navLines.slice(1).map((line) => {
          const cols = line.split(',')
          return Object.fromEntries(navHeaders.map((h, i) => [h, cols[i] ?? '']))
        })

        stats.navRowsTotal += navData.length

        // Bulk insert NAV history (upsert on conflict)
        for (const row of navData) {
          try {
            await db
              .insert(fundNavHistory)
              .values({
                fundId: fund.id,
                date: new Date(row.date ?? ''),
                nav: row.nav ?? '',
                navAdjusted: row.nav_adjusted || null,
              })
              .onConflictDoUpdate({
                target: [fundNavHistory.fundId, fundNavHistory.date],
                set: { nav: row.nav, navAdjusted: row.nav_adjusted || null },
              })
            stats.navRowsInserted++
          } catch (e) {
            stats.errors.push(`NAV row ${fund.bibitId} ${row.date}: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
      } catch (e) {
        stats.errors.push(`NAV ${fund.bibitId}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    return stats
  } catch (e) {
    stats.errors.push(`Sync failed: ${e instanceof Error ? e.message : String(e)}`)
    return stats
  }
}