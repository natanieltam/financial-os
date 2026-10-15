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
import { sql } from 'drizzle-orm'
import { accountStatus, accountType } from './enums'
import { users } from './users'

/**
 * PRD §16 — accounts.
 * Money columns are NUMERIC(20,2); never JS floats (PRD §17).
 */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: accountType('type').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('IDR'),
    initialBalance: numeric('initial_balance', { precision: 20, scale: 2 }).notNull().default('0'),
    status: accountStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('accounts_user_idx').on(t.userId),
    uniqueIndex('accounts_active_name_uniq')
      .on(t.userId, t.name)
      .where(sql`status = 'active'`),
  ],
)
