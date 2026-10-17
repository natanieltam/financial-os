import {
  index,
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
 * Mutual funds master data — sourced from bibit-reksadana CSV (OJK/Bibit/Bareksa).
 * One row per fund product, not per user.
 */
export const mutualFunds = pgTable(
  'mutual_funds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // External identifiers
    bibitId: varchar('bibit_id', { length: 32 }).unique(), // e.g. 'RD831'
    bareksaId: varchar('bareksa_id', { length: 32 }),
    kontanId: varchar('kontan_id', { length: 32 }),
    ojkName: text('ojk_name'),
    // Fund metadata
    name: text('name').notNull(),
    otherNames: text('other_names'),
    manager: text('manager').notNull(),
    type: varchar('type', { length: 32 }).notNull(), // 'Pasar Uang', 'Obligasi', 'Saham', 'Campuran', 'Terproteksi', 'Global', 'DPLK', 'DIRE', 'ETF'
    currency: varchar('currency', { length: 3 }).notNull().default('IDR'),
    sharia: varchar('sharia', { length: 5 }).notNull().default('false'), // 'true' | 'false'
    launchDate: timestamp('launch_date', { withTimezone: true }),
    // Latest snapshot (updated by sync job)
    latestNav: numeric('latest_nav', { precision: 20, scale: 4 }),
    latestNavDate: timestamp('latest_nav_date', { withTimezone: true }),
    aum: numeric('aum', { precision: 20, scale: 2 }),
    // Returns (1D, 1M, 3M, YTD, 1Y, 3Y, 5Y, 10Y, inception)
    return1d: numeric('return_1d', { precision: 8, scale: 4 }),
    return1m: numeric('return_1m', { precision: 8, scale: 4 }),
    return3m: numeric('return_3m', { precision: 8, scale: 4 }),
    returnYtd: numeric('return_ytd', { precision: 8, scale: 4 }),
    return1y: numeric('return_1y', { precision: 8, scale: 4 }),
    return3y: numeric('return_3y', { precision: 8, scale: 4 }),
    return5y: numeric('return_5y', { precision: 8, scale: 4 }),
    return10y: numeric('return_10y', { precision: 8, scale: 4 }),
    returnInception: numeric('return_inception', { precision: 8, scale: 4 }),
    // Metadata
    expenseRatio: numeric('expense_ratio', { precision: 6, scale: 4 }),
    minPurchase: numeric('min_purchase', { precision: 20, scale: 2 }),
    custodianBank: text('custodian_bank'),
    isTradable: varchar('is_tradable', { length: 5 }).notNull().default('false'), // available on Bibit
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
 * Sourced from bibit-reksadana data/bibit/nav/{bibitId}.csv
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
    index('fund_nav_history_fund_idx').on(t.fundId),
    index('fund_nav_history_date_idx').on(t.date),
  ],
)

/**
 * User's tracked/watched funds — personal watchlist, not holdings.
 * Holdings would be in accounts (type='investment') + transactions.
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