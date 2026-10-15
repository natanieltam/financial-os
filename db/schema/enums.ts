import { pgEnum } from 'drizzle-orm/pg-core'

/** Transaction types incl. transfer (PRD §19). */
export const transactionType = pgEnum('transaction_type', ['income', 'expense', 'transfer'])

/** Income/expense only (categories, recurring transactions). */
export const moneyFlowType = pgEnum('money_flow_type', ['income', 'expense'])

/** PRD §16 account types. */
export const accountType = pgEnum('account_type', [
  'cash',
  'bank',
  'ewallet',
  'credit_card',
  'investment',
  'other',
])

/** PRD §16: accounts are archived, not hard-deleted. */
export const accountStatus = pgEnum('account_status', ['active', 'archived'])

/** PRD §29 budget periods. */
export const budgetPeriod = pgEnum('budget_period', ['weekly', 'monthly', 'yearly'])

/** PRD §30 goals: active, completed, archived. */
export const goalStatus = pgEnum('goal_status', ['active', 'completed', 'archived'])

/** PRD §32 recurring frequencies. */
export const recurringFrequency = pgEnum('recurring_frequency', [
  'daily',
  'weekly',
  'monthly',
  'yearly',
])

/** PRD §33 bill statuses. */
export const billStatus = pgEnum('bill_status', ['upcoming', 'due_soon', 'overdue', 'paid'])

/** AI message roles. */
export const messageRole = pgEnum('message_role', ['user', 'assistant', 'system'])
