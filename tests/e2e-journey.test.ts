/* eslint-disable @typescript-eslint/no-explicit-any -- raw API envelope assertions */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Full MVP acceptance journey (PRD \xa771 E2E list, \xa7101 end-to-end flow)
 * against the built server + deterministic AI test double:
 * register → accounts → income → expense → transfer → dashboard → budget →
 * goal → health → AI natural-language parse (preview, no mutation) → user
 * confirmation through TransactionService (idempotent) → reports → logout →
 * login again and data persists.
 */
const BASE = 'http://127.0.0.1:3100'
const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
const EMAIL = `finos-journey-${suffix}@example.com`
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

let cookie = ''
const acc: Record<string, string> = {}
const cat: Record<string, string> = {}

beforeAll(async () => {
  const r = await req('POST', '/api/auth/register', {
    body: { email: EMAIL, password: PASSWORD, name: 'Journey User' },
  })
  expect(r.status).toBe(201)
  if (r.cookie) {
    cookie = r.cookie
  } else {
    const login = await req('POST', '/api/auth/login', { body: { email: EMAIL, password: PASSWORD } })
    cookie = login.cookie!
  }
  expect(cookie).toBeTruthy()
}, 60_000)

afterAll(async () => {
  const env = fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8')
  const url = env.match(/DATABASE_URL=(.*)/)?.[1]?.trim()
  if (!url) return
  const pool = new Pool({ connectionString: url })
  try {
    const { rows } = await pool.query('select id from users where email = $1', [EMAIL])
    const id = rows[0]?.id
    if (id) {
      await pool.query('delete from transactions where user_id = $1', [id])
      await pool.query('delete from audit_logs where user_id = $1', [id])
      await pool.query('delete from budget_items where budget_id in (select id from budgets where user_id = $1)', [id])
      await pool.query('delete from budgets where user_id = $1', [id])
      await pool.query('delete from goals where user_id = $1', [id])
      await pool.query('delete from categories where user_id = $1', [id])
      await pool.query('delete from accounts where user_id = $1', [id])
      await pool.query('delete from sessions where user_id = $1', [id])
      await pool.query('delete from users where id = $1', [id])
    }
  } finally {
    await pool.end()
  }
})

describe('E2E journey (PRD \xa7101)', () => {
  it('1. creates the two accounts from the acceptance scenario', async () => {
    const bca = await req('POST', '/api/accounts', {
      cookie,
      body: { name: `BCA ${suffix}`, type: 'bank', initialBalance: '1000000' },
    })
    expect(bca.status).toBe(201)
    acc.bca = bca.body.data!.account.id
    const gopay = await req('POST', '/api/accounts', {
      cookie,
      body: { name: 'Bank Utama', type: 'ewallet', initialBalance: '500000' },
    })
    expect(gopay.status).toBe(201)
    acc.gopay = gopay.body.data!.account.id
  })

  it('2. records salary income and a food expense', async () => {
    const salaryCat = await req('POST', '/api/categories', {
      cookie,
      body: { name: `Gaji ${suffix}`, type: 'income' },
    })
    expect(salaryCat.status).toBe(201)
    cat.income = salaryCat.body.data!.category.id
    const foodCat = await req('POST', '/api/categories', {
      cookie,
      body: { name: `Makanan ${suffix}`, type: 'expense' },
    })
    expect(foodCat.status).toBe(201)
    cat.expense = foodCat.body.data!.category.id

    const income = await req('POST', '/api/transactions', {
      cookie,
      body: {
        type: 'income',
        accountId: acc.bca,
        categoryId: cat.income,
        amount: '5000000',
        transactionDate: TODAY,
        description: 'Gaji bulanan',
      },
    })
    expect(income.status).toBe(201)
    const expense = await req('POST', '/api/transactions', {
      cookie,
      body: {
        type: 'expense',
        accountId: acc.gopay,
        categoryId: cat.expense,
        amount: '500000',
        transactionDate: TODAY,
        description: 'Belanja grocery',
      },
    })
    expect(expense.status).toBe(201)
  })

  it('3. transfers between accounts and the dashboard totals are exact', async () => {
    const transfer = await req('POST', '/api/transactions', {
      cookie,
      body: {
        type: 'transfer',
        accountId: acc.bca,
        toAccountId: acc.gopay,
        amount: '200000',
        transactionDate: TODAY,
        idempotencyKey: `journey-transfer-${suffix}`,
      },
    })
    expect(transfer.status).toBe(201)
    expect(transfer.body.data!.transaction.transferGroupId).toBeTruthy()

    const dash = await req('GET', '/api/dashboard', { cookie })
    expect(dash.status).toBe(200)
    const data = dash.body.data!
    const byId = Object.fromEntries(
      (data.accounts as Array<{ id: string; balance: string }>).map((a) => [a.id, a.balance]),
    )
    expect(byId[acc.bca!]).toBe('5800000.00') // 1000000 + 5000000 - 200000
    expect(byId[acc.gopay!]).toBe('200000.00') // 500000 - 500000 + 200000
    expect(data.totals.balance).toBe('6000000.00')
  })

  it('4. the food budget shows live spent from the expense', async () => {
    const budget = await req('POST', '/api/budgets', {
      cookie,
      body: {
        name: `Bulanan ${suffix}`,
        period: 'monthly',
        startDate: TODAY,
        items: [{ categoryId: cat.expense, amount: '800000' }],
      },
    })
    expect(budget.status).toBe(201)
    const item = budget.body.data!.budget.items[0]
    expect(item.spent).toBe('500000.00')
    expect(item.percent).toBe(62.5)
    expect(item.status).toBe('healthy')
  })

  it('5. the goal tracks progress and the health score has 5 components', async () => {
    const goal = await req('POST', '/api/goals', {
      cookie,
      body: { name: `Dana Darurat ${suffix}`, targetAmount: '1000000', currentAmount: '250000' },
    })
    expect(goal.status).toBe(201)
    expect(goal.body.data!.goal.progressPercent).toBe(25)
    expect(goal.body.data!.goal.remainingAmount).toBe('750000.00')

    const health = await req('GET', '/api/health', { cookie })
    expect(health.status).toBe(200)
    expect((health.body.data!.components as unknown[]).length).toBe(5)
  })

  it('6. AI parses natural language into a PREVIEW only (no mutation)', async () => {
    const parsed = await req('POST', '/api/ai/transaction-parser', {
      cookie,
      body: { text: 'NLHAPPY makan siang kantor 45000' },
    })
    expect(parsed.status).toBe(200)
    const preview = parsed.body.data!.preview
    expect(preview).toBeTruthy()
    expect(preview.transaction.type).toBe('expense')
    expect(preview.transaction.amount).toBe('45000.00')
    // Resolved against the user's own accounts (server-side ownership check).
    expect([acc.bca, acc.gopay]).toContain(preview.transaction.accountId)

    // Golden rule 10: nothing is written until the user confirms.
    const txs = await req('GET', '/api/transactions?pageSize=100', { cookie })
    const rows = txs.body.data!.transactions as Array<{ amount: string }>
    expect(rows.filter((t) => t.amount === '45000.00')).toHaveLength(0)
  })

  it('7. confirmation goes through TransactionService (idempotent replay)', async () => {
    const parsed = await req('POST', '/api/ai/transaction-parser', {
      cookie,
      body: { text: 'NLHAPPY makan siang kantor 45000' },
    })
    const transaction = parsed.body.data!.preview.transaction
    const key = `journey-ai-${suffix}`
    const first = await req('POST', '/api/transactions', { cookie, body: { ...transaction, idempotencyKey: key } })
    expect(first.status).toBe(201)
    const replay = await req('POST', '/api/transactions', { cookie, body: { ...transaction, idempotencyKey: key } })
    expect(replay.status).toBe(200)
    expect(replay.body.data!.deduplicated).toBe(true)
    expect(replay.body.data!.transaction.id).toBe(first.body.data!.transaction.id)

    // Exactly one such transaction exists.
    const txs = await req('GET', '/api/transactions?pageSize=100', { cookie })
    const rows = txs.body.data!.transactions as Array<{ amount: string }>
    expect(rows.filter((t) => t.amount === '45000.00')).toHaveLength(1)
  })

  it('8. reports match the live data exactly (deterministic math)', async () => {
    const r = await req('GET', '/api/reports/summary?period=30d', { cookie })
    expect(r.status).toBe(200)
    expect(r.body.data!.current.income).toBe('5000000.00')
    expect(r.body.data!.current.expense).toBe('545000.00') // 500000 + 45000
    expect(r.body.data!.current.net).toBe('4455000.00')
  })

  it('9. logout invalidates the session and a fresh login sees all data', async () => {
    const out = await req('POST', '/api/auth/logout', { cookie })
    expect(out.status).toBe(200)
    const after = await req('GET', '/api/me', { cookie })
    expect(after.status).toBe(401)

    const back = await req('POST', '/api/auth/login', { body: { email: EMAIL, password: PASSWORD } })
    expect(back.status).toBe(200)
    const dash = await req('GET', '/api/dashboard', { cookie: back.cookie! })
    expect(dash.status).toBe(200)
    expect(dash.body.data!.totals.balance).toBe('5955000.00') // 6000000 - 45000 AI expense
    const accounts = dash.body.data!.accounts as Array<{ id: string }>
    expect(accounts.length).toBe(2)
  })
})
