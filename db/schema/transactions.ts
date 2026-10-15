import { check, index, numeric, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { transactionType } from './enums'
import { users } from './users'
import { accounts } from './accounts'
import { categories } from './categories'
import { recurringTransactions } from './recurring'

/**
 * PRD §19 — transactions (+ transfer support §21, soft delete §60).
 *
 * Ownership isolation (PRD §15): every row carries user_id; account_id is
 * RESTRICT so transaction history can never be destroyed by account deletion;
 * category_id is SET NULL (categories may be removed, history stays intact).
 *
 * transferGroupId: both legs of a transfer share one id (PRD §21, atomic).
 * recurringTransactionId: source template for idempotent recurring generation (§32).
 */
export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    recurringTransactionId: uuid('recurring_transaction_id').references(
      () => recurringTransactions.id,
      { onDelete: 'set null' },
    ),
    type: transactionType('type').notNull(),
    /**
     * Transfers store two positive-amount legs; direction tells which side of
     * the money flow the leg represents (PRD §21). Null for income/expense.
     */
    transferDirection: varchar('transfer_direction', { length: 3 }),
    /** Replay/double-click protection (PRD §22) — set on the source leg. */
    idempotencyKey: text('idempotency_key'),
    amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),
    description: text('description'),
    merchant: varchar('merchant', { length: 120 }),
    notes: text('notes'),
    transactionDate: timestamp('transaction_date', { withTimezone: true }).notNull(),
    transferGroupId: uuid('transfer_group_id'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('transactions_user_date_idx').on(t.userId, t.transactionDate.desc()),
    index('transactions_user_account_idx').on(t.userId, t.accountId),
    index('transactions_user_category_idx').on(t.userId, t.categoryId),
    index('transactions_recurring_idx').on(t.recurringTransactionId),
    index('transactions_transfer_group_idx')
      .on(t.transferGroupId)
      .where(sql`transfer_group_id is not null`),
    uniqueIndex('transactions_idempotency_uniq')
      .on(t.userId, t.idempotencyKey)
      .where(sql`idempotency_key is not null`),
    check('transactions_amount_positive', sql`amount > 0`),
    check(
      'transactions_transfer_direction_valid',
      sql`transfer_direction is null or transfer_direction in ('in', 'out')`,
    ),
    check(
      'transactions_transfer_direction_required',
      sql`(type = 'transfer') = (transfer_direction is not null)`,
    ),
  ],
)
