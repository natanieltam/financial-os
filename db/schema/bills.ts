import { check, date, index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { billStatus } from './enums'
import { users } from './users'
import { accounts } from './accounts'
import { categories } from './categories'

/** PRD §33 — bills (upcoming / due soon / overdue / paid). */
export const bills = pgTable(
  'bills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),
    dueDate: date('due_date').notNull(),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    status: billStatus('status').notNull().default('upcoming'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('bills_user_due_idx').on(t.userId, t.dueDate),
    check('bills_amount_positive', sql`amount > 0`),
  ],
)
