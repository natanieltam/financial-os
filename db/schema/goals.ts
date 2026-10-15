import { check, date, index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { goalStatus } from './enums'
import { users } from './users'

/**
 * PRD §30 — goals.
 * Progress values are maintained by deterministic server logic only (PRD §26).
 */
export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    targetAmount: numeric('target_amount', { precision: 20, scale: 2 }).notNull(),
    currentAmount: numeric('current_amount', { precision: 20, scale: 2 }).notNull().default('0'),
    deadline: date('deadline'),
    status: goalStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('goals_user_idx').on(t.userId),
    check('goals_target_positive', sql`target_amount > 0`),
    check('goals_current_nonnegative', sql`current_amount >= 0`),
  ],
)
