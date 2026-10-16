import { z } from 'zod'
import { moneyToCents, normalizeMoney } from '../money'
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  BILL_STATUSES,
  BUDGET_PERIODS,
  FORECAST_HORIZONS,
  GOAL_STATUSES,
  MONEY_FLOW_TYPES,
  RECURRING_FREQUENCIES,
  TRANSACTION_TYPES,
} from '../constants/finance'

/**
 * Request validation shared by API routes and UI forms.
 * Amounts are validated as precise decimal strings — never floats (PRD §17).
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export const dateStringSchema = z
  .string()
  .regex(DATE_ONLY, 'Expected date YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Invalid date')

function moneyField(opts: { positive?: boolean; nonNegative?: boolean } = {}) {
  return z
    .union([z.string(), z.number()])
    .transform((value, ctx) => {
      try {
        return normalizeMoney(value)
      } catch (err) {
        ctx.addIssue({ code: 'custom', message: (err as Error).message })
        return z.NEVER
      }
    })
    .refine((value) => {
      if (opts.positive) return moneyToCents(value) > 0n
      return true
    }, 'Amount must be greater than zero')
    .refine((value) => {
      if (opts.nonNegative) return moneyToCents(value) >= 0n
      return true
    }, 'Amount cannot be negative')
}

const idSchema = z.string().uuid('Invalid id')

/* ---------------------------------- accounts ---------------------------------- */

export const accountCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  type: z.enum(ACCOUNT_TYPES),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/, 'Currency must be a 3-letter code')
    .transform((v) => v.toUpperCase())
    .default('IDR'),
  initialBalance: moneyField().optional(),
})
export type AccountCreateInput = z.infer<typeof accountCreateSchema>

export const accountUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    type: z.enum(ACCOUNT_TYPES).optional(),
    status: z.enum(ACCOUNT_STATUSES).optional(),
    initialBalance: moneyField().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'No fields to update')
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>

/* --------------------------------- categories --------------------------------- */

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  type: z.enum(MONEY_FLOW_TYPES),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex value')
    .optional(),
  icon: z.string().trim().max(32).optional(),
})
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>

export const categoryUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    icon: z.string().trim().max(32).optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    isArchived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'No fields to update')
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>

/* -------------------------------- transactions -------------------------------- */

const dateStringField = z.union([
  dateStringSchema, // quick-add sends plain dates (stored at UTC noon)
  z.string().datetime({ offset: true }), // full ISO timestamps
])

export const transactionCreateSchema = z
  .object({
    type: z.enum(TRANSACTION_TYPES),
    accountId: idSchema,
    toAccountId: idSchema.optional(),
    categoryId: idSchema.nullable().optional(),
    amount: moneyField({ positive: true }),
    description: z.string().trim().max(200).nullable().optional(),
    merchant: z.string().trim().max(120).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    transactionDate: dateStringField,
    idempotencyKey: z.string().trim().min(8).max(64).optional(),
  })
  .refine((v) => v.type !== 'transfer' || Boolean(v.toAccountId), {
    message: 'Destination account is required for transfers',
    path: ['toAccountId'],
  })
export type TransactionCreateInput = z.infer<typeof transactionCreateSchema>

export const transactionUpdateSchema = z
  .object({
    accountId: idSchema.optional(),
    toAccountId: idSchema.optional(),
    categoryId: idSchema.nullable().optional(),
    amount: moneyField({ positive: true }).optional(),
    description: z.string().trim().max(200).nullable().optional(),
    merchant: z.string().trim().max(120).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    transactionDate: dateStringField.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'No fields to update')
export type TransactionUpdateInput = z.infer<typeof transactionUpdateSchema>

export const transactionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(TRANSACTION_TYPES).optional(),
  accountId: idSchema.optional(),
  categoryId: idSchema.optional(),
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
  search: z.string().trim().max(100).optional(),
  minAmount: z.union([z.string(), z.number()]).optional(),
  maxAmount: z.union([z.string(), z.number()]).optional(),
})
export type TransactionListQuery = z.infer<typeof transactionListQuerySchema>

/* ---------------------------------- budgets ----------------------------------- */

export const budgetItemInputSchema = z.object({
  categoryId: idSchema,
  amount: moneyField({ nonNegative: true }),
})

export const budgetCreateSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(80),
    period: z.enum(BUDGET_PERIODS),
    startDate: dateStringSchema,
    endDate: dateStringSchema.nullable().optional(),
    items: z.array(budgetItemInputSchema).min(1, 'Add at least one category').max(50),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: 'End date must be after start date',
    path: ['endDate'],
  })
  .refine((v) => new Set(v.items.map((i) => i.categoryId)).size === v.items.length, {
    message: 'Duplicate categories in budget',
    path: ['items'],
  })
export type BudgetCreateInput = z.infer<typeof budgetCreateSchema>

export const budgetUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    period: z.enum(BUDGET_PERIODS).optional(),
    startDate: dateStringSchema.optional(),
    endDate: dateStringSchema.nullable().optional(),
    isArchived: z.boolean().optional(),
    items: z.array(budgetItemInputSchema).min(1).max(50).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'No fields to update')
  .refine((v) => !v.items || new Set(v.items.map((i) => i.categoryId)).size === v.items.length, {
    message: 'Duplicate categories in budget',
    path: ['items'],
  })
export type BudgetUpdateInput = z.infer<typeof budgetUpdateSchema>

/* ----------------------------------- goals ------------------------------------ */

export const goalCreateSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(80),
    targetAmount: moneyField({ positive: true }),
    currentAmount: moneyField({ nonNegative: true }).optional(),
    deadline: dateStringSchema.nullable().optional(),
  })
  .refine((v) => !v.deadline || v.deadline >= new Date().toISOString().slice(0, 10), {
    message: 'Deadline must be in the future',
    path: ['deadline'],
  })
export type GoalCreateInput = z.infer<typeof goalCreateSchema>

export const goalUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    targetAmount: moneyField({ positive: true }).optional(),
    currentAmount: moneyField({ nonNegative: true }).optional(),
    deadline: dateStringSchema.nullable().optional(),
    status: z.enum(GOAL_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'No fields to update')
export type GoalUpdateInput = z.infer<typeof goalUpdateSchema>

export const goalProjectionSchema = z.object({
  monthlyContribution: moneyField({ positive: true }),
})

/* ----------------------------------- queries ----------------------------------- */

export const listQuerySchema = z.object({
  includeArchived: z
    .union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')])
    .optional(),
  type: z.enum(ACCOUNT_TYPES).optional(),
  flow: z.enum(MONEY_FLOW_TYPES).optional(),
  search: z.string().trim().max(60).optional(),
})

/* ------------------------------ recurring (PRD §32) ------------------------------ */

export const recurringCreateSchema = z.object({
  type: z.enum(MONEY_FLOW_TYPES),
  accountId: idSchema,
  categoryId: idSchema.nullable().optional(),
  amount: moneyField({ positive: true }),
  description: z.string().trim().min(1, 'Description is required').max(200),
  frequency: z.enum(RECURRING_FREQUENCIES),
  nextDueDate: dateStringField,
  endDate: dateStringField.nullable().optional(),
})
export type RecurringCreateInput = z.infer<typeof recurringCreateSchema>

export const recurringUpdateSchema = z
  .object({
    accountId: idSchema.optional(),
    categoryId: idSchema.nullable().optional(),
    amount: moneyField({ positive: true }).optional(),
    description: z.string().trim().min(1).max(200).optional(),
    frequency: z.enum(RECURRING_FREQUENCIES).optional(),
    nextDueDate: dateStringField.optional(),
    endDate: dateStringField.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'No fields to update')
export type RecurringUpdateInput = z.infer<typeof recurringUpdateSchema>

export const recurringListQuerySchema = z.object({
  active: z.union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')]).optional(),
})

/* -------------------------------- bills (PRD §33) -------------------------------- */

export const billCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  amount: moneyField({ positive: true }),
  dueDate: dateStringField,
  accountId: idSchema.nullable().optional(),
  categoryId: idSchema.nullable().optional(),
})
export type BillCreateInput = z.infer<typeof billCreateSchema>

export const billUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    amount: moneyField({ positive: true }).optional(),
    dueDate: dateStringField.optional(),
    accountId: idSchema.nullable().optional(),
    categoryId: idSchema.nullable().optional(),
    status: z.enum(BILL_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'No fields to update')
export type BillUpdateInput = z.infer<typeof billUpdateSchema>

/* ------------------------------ AI endpoints (PRD §37–§39) ------------------------------ */

export const aiParseRequestSchema = z.object({
  text: z.string().trim().min(1, 'Enter a transaction note').max(500),
})
export type AiParseRequest = z.infer<typeof aiParseRequestSchema>

export const aiAskRequestSchema = z.object({
  question: z.string().trim().min(1, 'Question is required').max(1000),
  conversationId: idSchema.optional(),
})
export type AiAskRequest = z.infer<typeof aiAskRequestSchema>

/* -------------------------------- forecast (PRD §36) -------------------------------- */

export const forecastQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((v) => (FORECAST_HORIZONS as readonly number[]).includes(v), 'Forecast horizon must be 30, 60 or 90 days')
    .default(30),
})
export type ForecastQuery = z.infer<typeof forecastQuerySchema>

