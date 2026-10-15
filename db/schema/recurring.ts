import {
  boolean,
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { moneyFlowType, recurringFrequency } from './enums'
import { users } from './users'
import { accounts } from './accounts'
import { categories } from './categories'

/**
 * PRD §32 — recurring transactions.
 * Generation is idempotent: generated transactions reference back via
 * transactions.recurring_transaction_id + due date.
 */
export const recurringTransactions = pgTable(
  'recurring_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    type: moneyFlowType('type').notNull(),
    amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),
    description: text('description'),
    frequency: recurringFrequency('frequency').notNull(),
    nextDueDate: date('next_due_date').notNull(),
    endDate: date('end_date'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('recurring_user_next_due_idx').on(t.userId, t.nextDueDate),
    check('recurring_amount_positive', sql`amount > 0`),
  ],
)
