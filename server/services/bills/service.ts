import { and, asc, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { getDatabase } from '../../../db/client'
import { accounts, bills, categories } from '../../../db/schema/index'
import type { BillCreateInput, BillUpdateInput } from '../../../shared/schemas/finance'
import { BILL_DUE_SOON_DAYS, type BillStatus } from '../../../shared/constants/finance'
import { apiErrors } from '../../utils/api'
import { audit } from '../../utils/audit'
import { getOwnedAccount } from '../accounts/service'
import { assertCategoryUsable } from '../categories/service'
import { createTransaction } from '../transactions/service'

/**
 * Bills (Phase 17, PRD §33). Status is derived deterministically from the due
 * date at read time — never trusted from the client. Paying a bill records a
 * real expense through TransactionService with the deterministic
 * `bill:{id}` idempotency key, so retries can never double-charge.
 * Date columns are DATE -> plain 'YYYY-MM-DD' strings end-to-end.
 */

export interface BillDTO {
  id: string
  name: string
  amount: string
  dueDate: string
  status: BillStatus
  accountId: string | null
  accountName: string | null
  categoryId: string | null
  categoryName: string | null
  paidAt: string | null
  createdAt: string
  updatedAt: string
}

type BillRow = typeof bills.$inferSelect

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Pure status derivation (PRD §33): paid stays paid; overdue beats due soon. */
export function computeBillStatus(
  row: { status: string; dueDate: string; paidAt: Date | null },
  today: Date,
): BillStatus {
  if (row.paidAt || row.status === 'paid') return 'paid'
  const startOfToday = isoDay(today)
  if (row.dueDate < startOfToday) return 'overdue'
  const soon = new Date(`${startOfToday}T12:00:00.000Z`)
  soon.setUTCDate(soon.getUTCDate() + BILL_DUE_SOON_DAYS)
  if (row.dueDate <= isoDay(soon)) return 'due_soon'
  return 'upcoming'
}

function toDTO(row: BillRow & { accountName: string | null; categoryName: string | null }, today: Date): BillDTO {
  return {
    id: row.id,
    name: row.name,
    amount: row.amount,
    dueDate: row.dueDate,
    status: computeBillStatus(row, today),
    accountId: row.accountId,
    accountName: row.accountName,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function getOwnedBill(userId: string, id: string): Promise<BillRow> {
  const rows = await getDatabase()
    .select()
    .from(bills)
    .where(and(eq(bills.id, id), eq(bills.userId, userId)))
    .limit(1)
  const row = rows[0]
  if (!row) throw apiErrors.notFound('Bill not found')
  return row
}

async function assertBillReferences(
  userId: string,
  input: { accountId?: string | null; categoryId?: string | null },
): Promise<void> {
  if (input.accountId) {
    const account = await getOwnedAccount(userId, input.accountId)
    if (account.status !== 'active') throw apiErrors.validation('Account is archived')
  }
  if (input.categoryId) {
    await assertCategoryUsable(userId, input.categoryId, 'expense')
  }
}

export async function listBills(
  userId: string,
  opts: { status?: BillStatus; today?: Date } = {},
): Promise<BillDTO[]> {
  const today = opts.today ?? new Date()
  const rows = await getDatabase()
    .select({ row: bills, accountName: accounts.name, categoryName: categories.name })
    .from(bills)
    .leftJoin(accounts, eq(bills.accountId, accounts.id))
    .leftJoin(categories, eq(bills.categoryId, categories.id))
    .where(eq(bills.userId, userId))
    .orderBy(asc(bills.dueDate))
  const items = rows.map((r: (typeof rows)[number]) =>
    toDTO({ ...r.row, accountName: r.accountName, categoryName: r.categoryName }, today),
  )
  return opts.status ? items.filter((b) => b.status === opts.status) : items
}

export async function getBill(userId: string, id: string): Promise<BillDTO> {
  const row = await getOwnedBill(userId, id)
  const joined = await getDatabase()
    .select({ accountName: accounts.name, categoryName: categories.name })
    .from(bills)
    .leftJoin(accounts, eq(bills.accountId, accounts.id))
    .leftJoin(categories, eq(bills.categoryId, categories.id))
    .where(and(eq(bills.id, id), eq(bills.userId, userId)))
    .limit(1)
  return toDTO(
    { ...row, accountName: joined[0]?.accountName ?? null, categoryName: joined[0]?.categoryName ?? null },
    new Date(),
  )
}

export async function createBill(userId: string, input: BillCreateInput): Promise<BillDTO> {
  await assertBillReferences(userId, input)
  const [row] = await getDatabase()
    .insert(bills)
    .values({
      userId,
      name: input.name,
      amount: input.amount,
      dueDate: input.dueDate,
      accountId: input.accountId ?? null,
      categoryId: input.categoryId ?? null,
    })
    .returning()
  await audit(null, 'bill_created', {
    userId,
    entityType: 'bill',
    entityId: row!.id,
    metadata: { amount: input.amount },
  })
  return getBill(userId, row!.id)
}

export async function updateBill(userId: string, id: string, input: BillUpdateInput): Promise<BillDTO> {
  const existing = await getOwnedBill(userId, id)
  if (input.status && input.status !== 'paid' && existing.paidAt) {
    throw apiErrors.validation('A paid bill cannot return to an unpaid status')
  }
  await assertBillReferences(userId, input)
  await getDatabase()
    .update(bills)
    .set({
      ...(input.name ? { name: input.name } : {}),
      ...(input.amount ? { amount: input.amount } : {}),
      ...(input.dueDate ? { dueDate: input.dueDate } : {}),
      ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.status === 'paid' ? { status: 'paid', paidAt: new Date() } : {}),
    })
    .where(and(eq(bills.id, id), eq(bills.userId, userId)))
  await audit(null, 'bill_updated', { userId, entityType: 'bill', entityId: id })
  return getBill(userId, id)
}

export async function deleteBill(userId: string, id: string): Promise<void> {
  await getOwnedBill(userId, id)
  await getDatabase().delete(bills).where(and(eq(bills.id, id), eq(bills.userId, userId)))
  await audit(null, 'bill_deleted', { userId, entityType: 'bill', entityId: id })
}

export interface PayBillResult {
  bill: BillDTO
  transactionId: string
  deduplicated: boolean
}

/**
 * Marks a bill paid AND records the real expense via TransactionService with
 * idempotency key `bill:{id}` — a failed update can be retried without
 * double-recording (Phase 17 idempotency requirement).
 */
export async function payBill(event: H3Event, userId: string, id: string): Promise<PayBillResult> {
  const bill = await getOwnedBill(userId, id)
  if (bill.paidAt || bill.status === 'paid') throw apiErrors.conflict('Bill is already paid')
  if (!bill.accountId) throw apiErrors.validation('Set an account on this bill before marking it paid')

  const created = await createTransaction(event, userId, {
    type: 'expense',
    accountId: bill.accountId,
    categoryId: bill.categoryId,
    amount: bill.amount,
    description: bill.name,
    transactionDate: isoDay(new Date()),
    idempotencyKey: `bill:${bill.id}`,
  })

  await getDatabase()
    .update(bills)
    .set({ status: 'paid', paidAt: new Date() })
    .where(and(eq(bills.id, id), eq(bills.userId, userId)))
  await audit(null, 'bill_paid', {
    userId,
    entityType: 'bill',
    entityId: id,
    metadata: { transactionId: created.transaction.id },
  })

  return { bill: await getBill(userId, id), transactionId: created.transaction.id, deduplicated: created.deduplicated }
}
