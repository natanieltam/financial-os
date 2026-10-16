/** Shared finance constants — PRD §16–§19 domain vocabularies. */

export const ACCOUNT_TYPES = [
  'cash',
  'bank',
  'ewallet',
  'credit_card',
  'investment',
  'other',
] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

export const ACCOUNT_STATUSES = ['active', 'archived'] as const
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number]

export const TRANSACTION_TYPES = ['income', 'expense', 'transfer'] as const
export type TransactionType = (typeof TRANSACTION_TYPES)[number]

export const MONEY_FLOW_TYPES = ['income', 'expense'] as const
export type MoneyFlowType = (typeof MONEY_FLOW_TYPES)[number]

export const BUDGET_PERIODS = ['weekly', 'monthly', 'yearly'] as const
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number]

export const BUDGET_STATUSES = ['healthy', 'warning', 'exceeded'] as const
export type BudgetStatus = (typeof BUDGET_STATUSES)[number]

export const GOAL_STATUSES = ['active', 'completed', 'archived'] as const
export type GoalStatus = (typeof GOAL_STATUSES)[number]

/* PRD §32 — recurring transactions */
export const RECURRING_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number]

/* PRD §33 — bills */
export const BILL_STATUSES = ['upcoming', 'due_soon', 'overdue', 'paid'] as const
export type BillStatus = (typeof BILL_STATUSES)[number]
/** A bill counts as due soon within this many days of its due date. */
export const BILL_DUE_SOON_DAYS = 3

/* PRD §36 — cashflow forecast horizons */
export const FORECAST_HORIZONS = [30, 60, 90] as const
export type ForecastHorizon = (typeof FORECAST_HORIZONS)[number]

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  cash: 'Cash',
  bank: 'Bank',
  ewallet: 'E-Wallet',
  credit_card: 'Kartu Kredit',
  investment: 'Investasi',
  other: 'Lainnya',
}

/** PRD §18 — default categories seeded once as global system rows. */
export const DEFAULT_EXPENSE_CATEGORIES = [
  'Food',
  'Transport',
  'Shopping',
  'Entertainment',
  'Bills',
  'Health',
  'Education',
  'Personal',
  'Housing',
  'Other',
] as const

export const DEFAULT_INCOME_CATEGORIES = [
  'Salary',
  'Freelance',
  'Business',
  'Investment',
  'Gift',
  'Other',
] as const

/** Stable ids for system categories (seeded idempotently, PRD §95). */
export function systemCategoryIds(): Record<string, string> {
  const ids: Record<string, string> = {}
  DEFAULT_EXPENSE_CATEGORIES.forEach((name, i) => {
    ids[`expense:${name}`] = `a1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`
  })
  DEFAULT_INCOME_CATEGORIES.forEach((name, i) => {
    ids[`income:${name}`] = `b2000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`
  })
  return ids
}
