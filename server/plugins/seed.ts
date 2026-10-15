import { and, eq, sql } from 'drizzle-orm'
import { getDatabase } from '../../db/client'
import { accounts, categories, users } from '../../db/schema/index'
import { hashPassword } from '../utils/password'
import { ensureSystemCategories } from '../services/categories/service'
import { createTransaction } from '../services/transactions/service'
import { createBudget } from '../services/budgets/service'
import { createGoal } from '../services/goals/service'

/**
 * Development bootstrap (PRD §25): if the local database has no users, create
 * demo@example.com / demo1234 with sample accounts, transactions, a budget and
 * a goal so the UI is verifiable in a real browser. Production check: refuse
 * when PUBLIC_BASE_URL or NUXT_PUBLIC_APP_URL is a non-localhost host.
 */

function isProductionHost(): boolean {
  const candidates = [
    process.env.PUBLIC_BASE_URL,
    process.env.NUXT_PUBLIC_APP_URL,
  ].filter(Boolean) as string[]
  return candidates.some((value) => {
    try {
      const host = new URL(value).hostname
      return host !== 'localhost' && host !== '127.0.0.1' && !host.endsWith('.ts.net')
    } catch {
      return false
    }
  })
}

export default function seedPlugin(): void {
  void seedDevelopmentData()
}

async function seedDevelopmentData(): Promise<void> {
  if (process.env.DISABLE_DEMO_SEED === '1') return
  if (isProductionHost()) return
  const db = getDatabase()
  try {
    const existing = await db.select({ id: users.id }).from(users).limit(1)
    if (existing.length > 0) return

    const passwordHash = await hashPassword('demo1234')
    const [user] = await db
      .insert(users)
      .values({
        email: 'demo@example.com',
        passwordHash,
        name: 'Demo User',
      })
      .returning({ id: users.id })
    if (!user) return
    const userId = user.id

    await ensureSystemCategories()

    // idempotent guard: never touch foreign rows
    const owned = await db.select().from(accounts).where(eq(accounts.userId, userId)).limit(1)
    if (owned.length === 0) {
      await db
        .insert(accounts)
        .values([
          { userId, name: 'BCA', type: 'bank', initialBalance: '15000000' },
          { userId, name: 'GoPay', type: 'ewallet', initialBalance: '850000' },
          { userId, name: 'Cash', type: 'cash', initialBalance: '500000' },
          { userId, name: 'Credit Card', type: 'credit_card', initialBalance: '0' },
        ])
        .returning({ id: accounts.id, name: accounts.name })
      const byName = new Map(owned.map((a) => [a.name, a.id]))
      const today = new Date()
      const iso = (offsetDays: number): string => {
        const d = new Date(today.getTime() + offsetDays * 86_400_000)
        return d.toISOString().slice(0, 10)
      }
      const events: Array<() => Promise<unknown>> = [
        () =>
          createTransaction(null as never, userId, {
            type: 'income',
            accountId: byName.get('BCA') as string,
            amount: '12000000.00',
            transactionDate: iso(-40),
            description: 'Monthly salary',
            merchant: 'Employer',
          }),
        () =>
          createTransaction(null as never, userId, {
            type: 'income',
            accountId: byName.get('BCA') as string,
            amount: '12000000.00',
            transactionDate: iso(-10),
            description: 'Monthly salary',
            merchant: 'Employer',
          }),
        () =>
          createTransaction(null as never, userId, {
            type: 'expense',
            accountId: byName.get('BCA') as string,
            amount: '3500000.00',
            transactionDate: iso(-38),
            description: 'Rent',
            merchant: 'Landlord',
          }),
        () =>
          createTransaction(null as never, userId, {
            type: 'expense',
            accountId: byName.get('BCA') as string,
            amount: '3500000.00',
            transactionDate: iso(-8),
            description: 'Rent',
            merchant: 'Landlord',
          }),
        () =>
          createTransaction(null as never, userId, {
            type: 'expense',
            accountId: byName.get('GoPay') as string,
            amount: '125000.00',
            transactionDate: iso(-3),
            description: 'Groceries',
            merchant: 'Supermarket',
          }),
        () =>
          createTransaction(null as never, userId, {
            type: 'transfer',
            accountId: byName.get('BCA') as string,
            toAccountId: byName.get('GoPay') as string,
            amount: '500000.00',
            transactionDate: iso(-2),
            description: 'Top up',
          }),
        () =>
          createTransaction(null as never, userId, {
            type: 'expense',
            accountId: byName.get('Cash') as string,
            amount: '45000.00',
            transactionDate: iso(-1),
            description: 'Coffee',
            merchant: 'Kopi Kenangan',
          }),
      ]
      for (const event of events) await event()

      const firstExpenseCategory = await db
        .select()
        .from(categories)
        .where(
          and(
            sql`(${categories.userId} is null or ${categories.userId} = ${userId})`,
            eq(categories.type, 'expense'),
          ),
        )
        .limit(1)
      if (firstExpenseCategory[0]) {
        await createBudget(null as never, userId, {
          name: 'Monthly Budget',
          period: 'monthly',
          startDate: iso(-15),
          items: [{ categoryId: firstExpenseCategory[0].id, amount: '1000000.00' }],
        }).catch(() => null)
      }
      await createGoal(null as never, userId, {
        name: 'Emergency Fund',
        targetAmount: '30000000.00',
        currentAmount: '5000000.00',
      }).catch(() => null)
    }
  } catch (error) {
    console.warn('[seed] development seed skipped:', error instanceof Error ? error.message : error)
  }
}
