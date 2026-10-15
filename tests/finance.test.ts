/* eslint-disable @typescript-eslint/no-explicit-any -- test payloads exercise raw API envelopes */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Integration tests for Phases 4-11 against the built server (PRD completion
 * requirement: DB + API + authorization + validation + business logic + financial
 * calculations). Server is spawned by tests/globalSetup.ts on port 3100 with the
 * development database; every test user is purged in afterAll.
 */
const BASE = 'http://127.0.0.1:3100'
const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
const EMAIL_A = `finos-test-a-${suffix}@example.com`
const EMAIL_B = `finos-test-b-${suffix}@example.com`
const PASSWORD = 'Sup3rSecret!pw'
const TODAY = new Date().toISOString().slice(0, 10)

interface Envelope<T = any> {
  success: boolean
  data?: T
  error?: { code: string; message: string }
}

interface Res<T = any> {
  status: number
  body: Envelope<T>
  cookie?: string
}

async function req<T = any>(
  method: string,
  urlPath: string,
  opts: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
): Promise<Res<T>> {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  const setCookies = res.headers.getSetCookie?.() ?? []
  const session = setCookies.find((c) => c.startsWith('finos_session='))
  let body: Envelope<T> = { success: false }
  try {
    body = (await res.json()) as Envelope<T>
  } catch {
    /* non-json */
  }
  return { status: res.status, body, cookie: session ? session.split(';')[0] : undefined }
}

let cookieA = ''
let cookieB = ''
const acc = { bca: '', gopay: '' } // user A accounts
const cat = { income: '', expense: '', custom: '', budget: '' } // user A categories
let budgetId = ''
let goalId = ''
let expense100kId = '' // will be soft-deleted mid-suite

async function login(email: string): Promise<string> {
  const r = await req('POST', '/api/auth/login', { body: { email, password: PASSWORD } })
  expect(r.status).toBe(200)
  expect(r.cookie).toBeTruthy()
  return r.cookie!
}

async function balanceOf(cookie: string, accountId: string): Promise<string> {
  const r = await req('GET', `/api/accounts/${accountId}`, { cookie })
  expect(r.status).toBe(200)
  return r.body.data!.account.balance as string
}

beforeAll(async () => {
  const ra = await req('POST', '/api/auth/register', {
    body: { email: EMAIL_A, password: PASSWORD, name: 'Finos A' },
  })
  expect(ra.status).toBe(201)
  cookieA = (await login(EMAIL_A))
  const rb = await req('POST', '/api/auth/register', {
    body: { email: EMAIL_B, password: PASSWORD, name: 'Finos B' },
  })
  expect(rb.status).toBe(201)
  cookieB = (await login(EMAIL_B))
}, 60_000)

afterAll(async () => {
  const env = fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8')
  const url = env.match(/DATABASE_URL=(.*)/)?.[1]?.trim()
  if (!url) return
  const pool = new Pool({ connectionString: url })
  try {
    const { rows } = await pool.query(`select id from users where email in ($1, $2)`, [EMAIL_A, EMAIL_B])
    const ids = rows.map((r: { id: string }) => r.id)
    if (ids.length) {
      const list = ids.map((_, i) => `$${i + 1}`).join(', ')
      await pool.query(`delete from transactions where user_id in (${list})`, ids)
      await pool.query(`delete from audit_logs where user_id in (${list})`, ids)
      await pool.query(
        `delete from budget_items where budget_id in (select id from budgets where user_id in (${list}))`,
        ids,
      )
      await pool.query(`delete from budgets where user_id in (${list})`, ids)
      await pool.query(`delete from goals where user_id in (${list})`, ids)
      await pool.query(`delete from categories where user_id in (${list})`, ids)
      await pool.query(`delete from accounts where user_id in (${list})`, ids)
      await pool.query(`delete from sessions where user_id in (${list})`, ids)
      await pool.query(`delete from users where id in (${list})`, ids)
    }
  } finally {
    await pool.end()
  }
})

describe('Phase 4 - Accounts', () => {
  it('rejects unauthenticated access', async () => {
    const r = await req('GET', '/api/accounts')
    expect(r.status).toBe(401)
    expect(r.body.error?.code).toBe('UNAUTHORIZED')
  })

  it('creates an account with initial balance (server-derived balance)', async () => {
    const r = await req('POST', '/api/accounts', {
      cookie: cookieA,
      body: { name: `BCA ${suffix}`, type: 'bank', initialBalance: '1000000' },
    })
    expect(r.status).toBe(201)
    expect(r.body.data!.account.balance).toBe('1000000.00')
    acc.bca = r.body.data!.account.id
  })

  it('creates a second account', async () => {
    const r = await req('POST', '/api/accounts', {
      cookie: cookieA,
      body: { name: `GoPay ${suffix}`, type: 'ewallet', initialBalance: '500000' },
    })
    expect(r.status).toBe(201)
    expect(r.body.data!.account.balance).toBe('500000.00')
    acc.gopay = r.body.data!.account.id
  })

  it('lists only the authenticated user accounts', async () => {
    const r = await req('GET', '/api/accounts', { cookie: cookieA })
    expect(r.status).toBe(200)
    const accounts = r.body.data!.accounts as Array<{ id: string; balance: string }>
    expect(accounts.length).toBe(2)
    expect(accounts.map((a) => a.id).sort()).toEqual([acc.bca, acc.gopay].sort())
  })

  it('rejects duplicate active account names with CONFLICT', async () => {
    const r = await req('POST', '/api/accounts', {
      cookie: cookieA,
      body: { name: `BCA ${suffix}`, type: 'bank' },
    })
    expect([409]).toContain(r.status)
    expect(r.body.error?.code).toBe('CONFLICT')
  })

  it('rejects invalid account type with VALIDATION_ERROR', async () => {
    const r = await req('POST', '/api/accounts', {
      cookie: cookieA,
      body: { name: `Weird ${suffix}`, type: 'crypto-bond' },
    })
    expect(r.status).toBe(400)
    expect(r.body.error?.code).toBe('VALIDATION_ERROR')
  })

  it('forbids user B from reading user A account', async () => {
    const r = await req('GET', `/api/accounts/${acc.bca}`, { cookie: cookieB })
    expect([403, 404]).toContain(r.status)
    expect(['FORBIDDEN', 'NOT_FOUND']).toContain(r.body.error?.code)
  })

  it('user B sees zero accounts', async () => {
    const r = await req('GET', '/api/accounts', { cookie: cookieB })
    expect(r.status).toBe(200)
    expect((r.body.data!.accounts as unknown[]).length).toBe(0)
  })
})

describe('Phase 5 - Categories', () => {
  it('ships default system income and expense categories', async () => {
    const r = await req('GET', '/api/categories', { cookie: cookieA })
    expect(r.status).toBe(200)
    const categories = r.body.data!.categories as Array<{ id: string; type: string; isSystem: boolean }>
    expect(categories.some((c) => c.type === 'income' && c.isSystem)).toBe(true)
    expect(categories.some((c) => c.type === 'expense' && c.isSystem)).toBe(true)
    cat.income = categories.find((c) => c.type === 'income')!.id
    cat.expense = categories.find((c) => c.type === 'expense')!.id
  })

  it('creates a custom category', async () => {
    const r = await req('POST', '/api/categories', {
      cookie: cookieA,
      body: { name: `Kopi ${suffix}`, type: 'expense', color: '#ff6600' },
    })
    expect(r.status).toBe(201)
    expect(r.body.data!.category.isSystem).toBe(false)
    cat.custom = r.body.data!.category.id
  })

  it('rejects unauthenticated category creation', async () => {
    const r = await req('POST', '/api/categories', { body: { name: 'X', type: 'expense' } })
    expect(r.status).toBe(401)
  })

  it('creates the dedicated budget-test category', async () => {
    const r = await req('POST', '/api/categories', {
      cookie: cookieA,
      body: { name: `BudgetCat ${suffix}`, type: 'expense' },
    })
    expect(r.status).toBe(201)
    cat.budget = r.body.data!.category.id
  })
})

describe('Phase 6 - Transactions (core)', () => {
  it('creates income and updates the account balance server-side', async () => {
    const r = await req('POST', '/api/transactions', {
      cookie: cookieA,
      body: {
        type: 'income',
        accountId: acc.bca,
        categoryId: cat.income,
        amount: '500000',
        transactionDate: TODAY,
        description: 'Salary',
      },
    })
    expect(r.status).toBe(201)
    expect(r.body.data!.transaction.type).toBe('income')
    expect(await balanceOf(cookieA, acc.bca)).toBe('1500000.00')
  })

  it('creates an expense and debits the account', async () => {
    const r = await req('POST', '/api/transactions', {
      cookie: cookieA,
      body: {
        type: 'expense',
        accountId: acc.gopay,
        categoryId: cat.expense,
        amount: '100000',
        transactionDate: TODAY,
      },
    })
    expect(r.status).toBe(201)
    expense100kId = r.body.data!.transaction.id
    expect(await balanceOf(cookieA, acc.gopay)).toBe('400000.00')
  })

  it('enforces category flow type (income transaction cannot use expense category)', async () => {
    const r = await req('POST', '/api/transactions', {
      cookie: cookieA,
      body: {
        type: 'income',
        accountId: acc.bca,
        categoryId: cat.expense,
        amount: '1000',
        transactionDate: TODAY,
      },
    })
    expect(r.status).toBe(400)
    expect(r.body.error?.code).toBe('VALIDATION_ERROR')
  })

  it('rejects non-positive amounts and malformed dates', async () => {
    const zero = await req('POST', '/api/transactions', {
      cookie: cookieA,
      body: { type: 'expense', accountId: acc.bca, categoryId: cat.expense, amount: '0', transactionDate: TODAY },
    })
    expect(zero.status).toBe(400)
    const negative = await req('POST', '/api/transactions', {
      cookie: cookieA,
      body: { type: 'expense', accountId: acc.bca, categoryId: cat.expense, amount: '-10', transactionDate: TODAY },
    })
    expect(negative.status).toBe(400)
    const badDate = await req('POST', '/api/transactions', {
      cookie: cookieA,
      body: { type: 'expense', accountId: acc.bca, categoryId: cat.expense, amount: '10', transactionDate: '2026-13-40' },
    })
    expect(badDate.status).toBe(400)
    expect(badDate.body.error?.code).toBe('VALIDATION_ERROR')
    // balances untouched by rejected writes
    expect(await balanceOf(cookieA, acc.bca)).toBe('1500000.00')
  })

  it('transfers 200000 BCA -> GoPay atomically (both legs, exact balances)', async () => {
    const r = await req('POST', '/api/transactions', {
      cookie: cookieA,
      body: {
        type: 'transfer',
        accountId: acc.bca,
        toAccountId: acc.gopay,
        amount: '200000',
        transactionDate: TODAY,
        idempotencyKey: `idem-${suffix}-1`,
      },
    })
    expect(r.status).toBe(201)
    expect(r.body.data!.transaction.transferGroupId).toBeTruthy()
    expect(await balanceOf(cookieA, acc.bca)).toBe('1300000.00')
    expect(await balanceOf(cookieA, acc.gopay)).toBe('600000.00')
  })

  it('idempotency: same key never double-spends', async () => {
    const r = await req('POST', '/api/transactions', {
      cookie: cookieA,
      body: {
        type: 'transfer',
        accountId: acc.bca,
        toAccountId: acc.gopay,
        amount: '200000',
        transactionDate: TODAY,
        idempotencyKey: `idem-${suffix}-1`,
      },
    })
    expect(r.status).toBe(200) // deduplicated replay
    expect(r.body.data!.deduplicated).toBe(true)
    expect(await balanceOf(cookieA, acc.bca)).toBe('1300000.00')
    expect(await balanceOf(cookieA, acc.gopay)).toBe('600000.00')
  })

  it('supports the Idempotency-Key header (PRD 22)', async () => {
    const r = await req('POST', '/api/transactions', {
      cookie: cookieA,
      headers: { 'idempotency-key': `hdr-${suffix}-1` },
      body: { type: 'expense', accountId: acc.gopay, categoryId: cat.expense, amount: '5000', transactionDate: TODAY },
    })
    expect(r.status).toBe(201)
    const replay = await req('POST', '/api/transactions', {
      cookie: cookieA,
      headers: { 'idempotency-key': `hdr-${suffix}-1` },
      body: { type: 'expense', accountId: acc.gopay, categoryId: cat.expense, amount: '5000', transactionDate: TODAY },
    })
    expect(replay.status).toBe(200)
    expect(replay.body.data!.deduplicated).toBe(true)
    expect(await balanceOf(cookieA, acc.gopay)).toBe('595000.00') // only once
  })

  it('rejects transfer to another user account without partial writes', async () => {
    const foreign = await req('POST', '/api/accounts', {
      cookie: cookieB,
      body: { name: `B-Only ${suffix}`, type: 'bank', initialBalance: '777000' },
    })
    expect(foreign.status).toBe(201)
    const foreignId = foreign.body.data!.account.id as string
    const beforeB = await balanceOf(cookieB, foreignId)
    const r = await req('POST', '/api/transactions', {
      cookie: cookieA,
      body: { type: 'transfer', accountId: acc.bca, toAccountId: foreignId, amount: '100', transactionDate: TODAY },
    })
    expect([403, 404]).toContain(r.status)
    expect(await balanceOf(cookieA, acc.bca)).toBe('1300000.00')
    expect(await balanceOf(cookieB, foreignId)).toBe(beforeB)
  })

  it('rejects same-account transfers and transfers with categories', async () => {
    const same = await req('POST', '/api/transactions', {
      cookie: cookieA,
      body: { type: 'transfer', accountId: acc.bca, toAccountId: acc.bca, amount: '10', transactionDate: TODAY },
    })
    expect(same.status).toBe(400)
    const withCat = await req('POST', '/api/transactions', {
      cookie: cookieA,
      body: { type: 'transfer', accountId: acc.bca, toAccountId: acc.gopay, amount: '10', categoryId: cat.expense, transactionDate: TODAY },
    })
    expect(withCat.status).toBe(400)
  })

  it('keeps 2-decimal precision (0.10 + 0.20 never becomes 0.30000000000000004)', async () => {
    for (const amount of ['0.10', '0.20']) {
      const r = await req('POST', '/api/transactions', {
        cookie: cookieA,
        body: { type: 'expense', accountId: acc.bca, categoryId: cat.custom, amount, transactionDate: TODAY },
      })
      expect(r.status).toBe(201)
    }
    expect(await balanceOf(cookieA, acc.bca)).toBe('1299999.70')
  })

  it('lists with pagination and type filter', async () => {
    const r = await req('GET', '/api/transactions?type=expense&page=1&pageSize=2', { cookie: cookieA })
    expect(r.status).toBe(200)
    const rows = r.body.data!.transactions as Array<{ type: string }>
    expect(rows.length).toBeLessThanOrEqual(2)
    expect(rows.every((t) => t.type === 'expense')).toBe(true)
    expect(r.body.data!.page).toBe(1)
    expect(r.body.data!.pageSize).toBe(2)
    expect(r.body.data!.total).toBeGreaterThan(2)
  })

  it('soft-deletes a transaction and restores the balance', async () => {
    expect(await balanceOf(cookieA, acc.gopay)).toBe('595000.00')
    const r = await req('DELETE', `/api/transactions/${expense100kId}`, { cookie: cookieA })
    expect(r.status).toBe(200)
    expect(await balanceOf(cookieA, acc.gopay)).toBe('695000.00') // +100000 restored
    const list = await req('GET', '/api/transactions?limit=100', { cookie: cookieA })
    const ids = (list.body.data!.transactions as Array<{ id: string }>).map((t) => t.id)
    expect(ids).not.toContain(expense100kId)
  })

  it('forbids user B from modifying user A transactions', async () => {
    const patch = await req('PATCH', `/api/transactions/${expense100kId}`, {
      cookie: cookieB,
      body: { amount: '1' },
    })
    expect([403, 404]).toContain(patch.status)
    const del = await req('DELETE', `/api/transactions/${expense100kId}`, { cookie: cookieB })
    expect([403, 404]).toContain(del.status)
  })
})

describe('Phase 8 - Budgets', () => {
  it('creates a monthly budget with items (window computed server-side)', async () => {
    const r = await req('POST', '/api/budgets', {
      cookie: cookieA,
      body: {
        name: `Monthly ${suffix}`,
        period: 'monthly',
        startDate: TODAY,
        items: [{ categoryId: cat.budget, amount: '300000' }],
      },
    })
    expect(r.status).toBe(201)
    const budget = r.body.data!.budget
    budgetId = budget.id
    expect(budget.items[0].amount).toBe('300000.00')
    expect(budget.items[0].spent).toBe('0.00')
    expect(budget.items[0].status).toBe('healthy')
    expect(budget.window.start).toBeTruthy()
    expect(budget.window.end).toBeTruthy()
  })

  it('rejects a budget without items', async () => {
    const r = await req('POST', '/api/budgets', {
      cookie: cookieA,
      body: { name: 'Empty', period: 'monthly', startDate: TODAY, items: [] },
    })
    expect(r.status).toBe(400)
    expect(r.body.error?.code).toBe('VALIDATION_ERROR')
  })

  it('computes spent/percent from live transactions (50% healthy)', async () => {
    const expense = await req('POST', '/api/transactions', {
      cookie: cookieA,
      body: { type: 'expense', accountId: acc.gopay, categoryId: cat.budget, amount: '150000', transactionDate: TODAY },
    })
    expect(expense.status).toBe(201)
    const r = await req('GET', `/api/budgets/${budgetId}`, { cookie: cookieA })
    expect(r.status).toBe(200)
    const item = r.body.data!.budget.items[0]
    expect(item.spent).toBe('150000.00')
    expect(item.percent).toBe(50)
    expect(item.status).toBe('healthy')
  })

  it('flags exceeded budgets (>100%)', async () => {
    const expense = await req('POST', '/api/transactions', {
      cookie: cookieA,
      body: { type: 'expense', accountId: acc.gopay, categoryId: cat.budget, amount: '200000', transactionDate: TODAY },
    })
    expect(expense.status).toBe(201)
    const r = await req('GET', `/api/budgets/${budgetId}`, { cookie: cookieA })
    const item = r.body.data!.budget.items[0]
    expect(item.spent).toBe('350000.00')
    expect(item.percent).toBe(116.67)
    expect(item.status).toBe('exceeded')
  })

  it('forbids user B from reading user A budget', async () => {
    const r = await req('GET', `/api/budgets/${budgetId}`, { cookie: cookieB })
    expect([403, 404]).toContain(r.status)
  })
})

describe('Phase 9 - Goals', () => {
  it('creates a goal with server-computed progress', async () => {
    const r = await req('POST', '/api/goals', {
      cookie: cookieA,
      body: { name: `Emergency ${suffix}`, targetAmount: '1000000', currentAmount: '200000' },
    })
    expect(r.status).toBe(201)
    goalId = r.body.data!.goal.id
    expect(r.body.data!.goal.progressPercent).toBe(20)
    expect(r.body.data!.goal.remainingAmount).toBe('800000.00')
  })

  it('rejects zero/negative targets and past deadlines', async () => {
    const zero = await req('POST', '/api/goals', {
      cookie: cookieA,
      body: { name: 'Zero', targetAmount: '0' },
    })
    expect(zero.status).toBe(400)
    const past = await req('POST', '/api/goals', {
      cookie: cookieA,
      body: { name: 'Past', targetAmount: '100000', deadline: '2020-01-01' },
    })
    expect(past.status).toBe(400)
  })

  it('what-if projection is deterministic (ceil of remaining/monthly)', async () => {
    const r = await req('GET', `/api/goals/${goalId}/projection?monthlyContribution=100000`, { cookie: cookieA })
    expect(r.status).toBe(200)
    expect(r.body.data!.projection.remaining).toBe('800000.00')
    expect(r.body.data!.projection.monthsNeeded).toBe(8)
    expect(r.body.data!.projection.completed).toBe(false)
  })

  it('forbids user B from reading user A goal', async () => {
    const r = await req('GET', `/api/goals/${goalId}`, { cookie: cookieB })
    expect([403, 404]).toContain(r.status)
  })
})

describe('Phase 7 + 10 + 11 - Dashboard, Health, Reports', () => {
  it('dashboard aggregates the exact balances (batched, server-computed)', async () => {
    const r = await req('GET', '/api/dashboard', { cookie: cookieA })
    expect(r.status).toBe(200)
    const data = r.body.data!
    const accounts = data.accounts as Array<{ balance: string }>
    const sum = accounts.reduce((acc2, a) => acc2 + BigInt(a.balance.replace('.', '')), 0n)
    expect(BigInt(String(data.totals.balance).replace('.', ''))).toBe(sum)
    expect(data.recentTransactions.length).toBeGreaterThan(0)
    expect(typeof data.health.score === 'number' || data.health.score === null).toBe(true)
  })

  it('health score uses fixed weights and marks missing components', async () => {
    const r = await req('GET', '/api/health', { cookie: cookieA })
    expect(r.status).toBe(200)
    const data = r.body.data!
    expect(data.components.length).toBe(5)
    if (data.score !== null) {
      expect(data.score).toBeGreaterThanOrEqual(0)
      expect(data.score).toBeLessThanOrEqual(100)
      const available = data.components.filter((c: { score: number | null }) => c.score !== null)
      const weightSum = available.reduce((sum: number, c: { weight: number }) => sum + c.weight, 0)
      expect(weightSum).toBeLessThanOrEqual(100)
    }
    expect(Array.isArray(data.unavailableComponents)).toBe(true)
  })

  it('summary report matches income/expense of live transactions (30d)', async () => {
    const r = await req('GET', '/api/reports/summary?period=30d', { cookie: cookieA })
    expect(r.status).toBe(200)
    // Income: 500000 (soft-deleted expenses excluded; transfer not counted)
    expect(r.body.data!.current.income).toBe('500000.00')
    // Expenses: 5000 + 0.10 + 0.20 + 150000 + 200000 = 355000.30 (100000 soft-deleted)
    expect(r.body.data!.current.expense).toBe('355000.30')
    expect(r.body.data!.current.net).toBe('144999.70')
  })

  it('cashflow report returns points', async () => {
    const r = await req('GET', '/api/reports/cashflow?granularity=month', { cookie: cookieA })
    expect(r.status).toBe(200)
    expect(r.body.data!.points.length).toBeGreaterThan(0)
  })

  it('category report totals live expenses only', async () => {
    const to = TODAY
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
    const r = await req('GET', `/api/reports/categories?from=${from}&to=${to}`, { cookie: cookieA })
    expect(r.status).toBe(200)
    expect(r.body.data!.totalExpense).toBe('355000.30')
  })

  it('account distribution total equals the sum of balances', async () => {
    const r = await req('GET', '/api/reports/accounts', { cookie: cookieA })
    expect(r.status).toBe(200)
    const accounts = r.body.data!.accounts as Array<{ balance: string }>
    const sum = accounts.reduce((acc2, a) => acc2 + BigInt(a.balance.replace('.', '')), 0n)
    expect(BigInt(String(r.body.data!.total).replace('.', ''))).toBe(sum)
  })

  it('budget performance report includes the budget', async () => {
    const r = await req('GET', '/api/reports/budgets', { cookie: cookieA })
    expect(r.status).toBe(200)
    const budgets = r.body.data!.budgets as Array<{ id: string }>
    expect(budgets.map((b) => b.id)).toContain(budgetId)
  })

  it('dashboard/report endpoints are isolated per user', async () => {
    const r = await req('GET', '/api/dashboard', { cookie: cookieB })
    expect(r.status).toBe(200)
    const ids = (r.body.data!.accounts as Array<{ id: string }>).map((a) => a.id)
    expect(ids).not.toContain(acc.bca)
    expect(ids).not.toContain(acc.gopay)
    expect(r.body.data!.recentTransactions.length).toBe(0)
  })
})

describe('Phase 5 - Category deletion integrity', () => {
  it('archives a category that still has transactions instead of deleting', async () => {
    // cat.custom has two expenses (0.10, 0.20) -> must archive, not delete
    const r = await req('DELETE', `/api/categories/${cat.custom}`, { cookie: cookieA })
    expect(r.status).toBe(200)
    expect(r.body.data!.archived).toBe(true)
    expect(r.body.data!.category.isArchived).toBe(true)
    const list = await req('GET', '/api/categories?includeArchived=true', { cookie: cookieA })
    const ids = (list.body.data!.categories as Array<{ id: string }>).map((c) => c.id)
    expect(ids).toContain(cat.custom)
  })

  it('deletes an unused category for real', async () => {
    const created = await req('POST', '/api/categories', {
      cookie: cookieA,
      body: { name: `Temp ${suffix}`, type: 'expense' },
    })
    expect(created.status).toBe(201)
    const freshId = created.body.data!.category.id as string
    const r = await req('DELETE', `/api/categories/${freshId}`, { cookie: cookieA })
    expect(r.status).toBe(200)
    expect(r.body.data!.archived).toBe(false)
    const list = await req('GET', '/api/categories', { cookie: cookieA })
    const ids = (list.body.data!.categories as Array<{ id: string }>).map((c) => c.id)
    expect(ids).not.toContain(freshId)
  })
})
