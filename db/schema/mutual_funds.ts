import {
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users'

/**
 * Mutual funds master data — sourced from the free `bibit-reksadana` CSV
 * (which mirrors OJK/Bibit/Bareksa listings). One row per fund product,
 * not per user.
 *
 * Returns are NOT denormalized here: the upstream CSV carries no performance
 * numbers at all, so period returns are derived from `fund_nav_history` at
 * read time (see `getFundReturns`). That keeps the stored data honest — a
 * return figure can never go stale relative to the NAV rows it came from.
 */
export const mutualFunds = pgTable(
  'mutual_funds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Stable upstream product code (CSV column `id`, e.g. 'BRK3', 'RD1').
     * Present on every row and unique, so it is the sync merge key.
     */
    code: varchar('code', { length: 32 }).notNull().unique(),
    // Vendor identifiers — `bibitId` is what per-fund NAV history is fetched by.
    bibitId: varchar('bibit_id', { length: 32 }), // null when upstream has no Bibit listing
    bareksaId: varchar('bareksa_id', { length: 32 }),
    kontanId: varchar('kontan_id', { length: 32 }),
    makmurId: varchar('makmur_id', { length: 32 }),
    ojkName: text('ojk_name'),
    // Fund metadata
    name: text('name').notNull(),
    otherNames: text('other_names'),
    manager: text('manager'), // 235 rows have no manager; nullable keeps them alive
    /** Upstream uses free-form labels: 'Pasar Uang', 'Terproteksi', 'Penyertaan Terbatas', ... */
    type: varchar('type', { length: 48 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('IDR'),
    sharia: varchar('sharia', { length: 5 }).notNull().default('false'), // 'true' | 'false'
    launchDate: timestamp('launch_date', { withTimezone: true }),
    isTradable: varchar('is_tradable', { length: 5 }).notNull().default('false'), // has a Bibit NAV feed
    // Latest snapshot, refreshed by the sync job from the newest NAV row.
    latestNav: numeric('latest_nav', { precision: 20, scale: 4 }),
    latestNavDate: timestamp('latest_nav_date', { withTimezone: true }),
    navRows: integer('nav_rows').notNull().default(0),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('mutual_funds_type_idx').on(t.type),
    index('mutual_funds_currency_idx').on(t.currency),
    index('mutual_funds_sharia_idx').on(t.sharia),
    index('mutual_funds_tradable_idx').on(t.isTradable),
    index('mutual_funds_manager_idx').on(t.manager),
  ],
)

/**
 * Daily NAV history per fund — one row per fund per trading day.
 * Sourced from `data/bibit/nav/{bibitId}.csv` (columns: date, nav, nav_adjusted).
 *
 * `nav` is the quoted NAV; `navAdjusted` is the dividend-reinvested series and
 * is preferred for period returns when present, because it is the honest
 * measure of what an investor actually earned.
 */
export const fundNavHistory = pgTable(
  'fund_nav_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fundId: uuid('fund_id')
      .notNull()
      .references(() => mutualFunds.id, { onDelete: 'cascade' }),
    date: timestamp('date', { withTimezone: true }).notNull(),
    nav: numeric('nav', { precision: 20, scale: 4 }).notNull(),
    navAdjusted: numeric('nav_adjusted', { precision: 20, scale: 4 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('fund_nav_history_fund_date_uniq').on(t.fundId, t.date),
    // Composite index serves both the "latest row per fund" lookup and per-fund range scans.
    index('fund_nav_history_fund_date_idx').on(t.fundId, t.date),
  ],
)

/**
 * User's tracked/watched funds — a personal watchlist, not holdings.
 * Holdings would live in `accounts` (type='investment') plus `transactions`.
 */
export const userFundWatchlist = pgTable(
  'user_fund_watchlist',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fundId: uuid('fund_id')
      .notNull()
      .references(() => mutualFunds.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_fund_watchlist_user_fund_uniq').on(t.userId, t.fundId),
    index('user_fund_watchlist_user_idx').on(t.userId),
  ],
)

export type MutualFund = typeof mutualFunds.$inferSelect
export type NewMutualFund = typeof mutualFunds.$inferInsert
export type FundNavHistory = typeof fundNavHistory.$inferSelect
export type NewFundNavHistory = typeof fundNavHistory.$inferInsert
export type UserFundWatchlist = typeof userFundWatchlist.$inferSelect
export type NewUserFundWatchlist = typeof userFundWatchlist.$inferInsert