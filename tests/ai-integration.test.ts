/* eslint-disable @typescript-eslint/no-explicit-any -- test payloads exercise raw API envelopes */
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Integration tests for Phases 12-17 against the BUILT server (globalSetup
 * starts .output/server/index.mjs on :3100 with PostgreSQL, plus an explicit
 * local OpenAI-compatible TEST DOUBLE on :3199 wired in through
 * KENARI_BASE_URL). The double is a deterministic fixture that routes on
 * markers in the note text — including provider failure modes (429 / 5xx /
 * empty choices / non-JSON) — so the real error-normalization paths are
 * exercised end-to-end. Application code never fabricates provider success.
 */
const BASE = 'http://127.0.0.1:3100'
const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
const EMAIL_A = `finos-ai-a-${suffix}@example.com`
const EMAIL_B = `finos-ai-b-${suffix}@example.com`
const PASSWORD = 'AiTest!2345'
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
  opts: { body?: unknown; cookie?: string } = {},
): Promise<Res<T>> {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
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

async function login(email: string): Promise<string> {
  const r = await req('POST', '/api/auth/login', { body: { email, password: PASSWORD } })
  expect(r.status).toBe(200)
  return r.cookie!
}

function toCents(value: string): bigint {
  const neg = value.startsWith('-')
  const [whole = '0', frac = '00'] = (neg ? value.slice(1) : value).split('.')
  const cents = BigInt(whole) * 100n + BigInt(frac.slice(0, 2).padEnd(2, '0'))
  return neg ? -cents : cents
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

let cookieA = ''
let cookieB = ''
let accountId = '' // user A account
let categoryId = '' // user A expense category
let happyPreview: any = null // parsed preview confirmed in a later test
let conversationId = ''
let recurringId = ''
let billId = ''

beforeAll(async () => {
  const ra = await req('POST', '/api/auth/register', { body: { email: EMAIL_A, password: PASSWORD, name: 'AI Finos A' } })
  expect(ra.status).toBe(201)
  cookieA = await login(EMAIL_A)
  const rb = await req('POST', '/api/auth/register', { body: { email: EMAIL_B, password: PASSWORD, name: 'AI Finos B' } })
  expect(rb.status).toBe(201)
  cookieB = await login(EMAIL_B)
}, 60_000)

describe('Phase 12 - security invariants around AI', () => {
  it('rejects unauthenticated AI access (401)', async () => {
    const parse = await req('POST', '/api/ai/transaction-parser', { body: { text: 'makan 10000' } })
    expect(parse.status).toBe(401)
    expect(parse.body.error?.code).toBe('UNAUTHORIZED')
    const ask = await req('POST', '/api/ai/ask', { body: { question: 'berapa?' } })
    expect(ask.status).toBe(401)
    const convs = await req('GET', '/api/ai/conversations')
    expect(convs.status).toBe(401)
  })

  it('rejects malformed conversation ids without leaking internals (404)', async () => {
    const r = await req('GET', '/api/ai/conversations/not-a-uuid', { cookie: cookieA })
    expect(r.status).toBe(404)
    expect(r.body.error?.code).toBe('NOT_FOUND')
  })
})

describe('Phase 14 - natural language transaction parser', () => {
  it('parses a note into a preview without mutating anything', async () => {
    const acc = await req('POST', '/api/accounts', {
      cookie: cookieA,
      body: { name: `BCA ${suffix}`, type: 'bank', initialBalance: '1000000' },
    })
    expect(acc.status).toBe(201)
    accountId = acc.body.data!.account.id
    expect(acc.body.data!.account.balance).toBe('1000000.00')

    const cat = await req('POST', '/api/categories', {
      cookie: cookieA,
      body: { name: `Makan ${suffix}`, type: 'expense' },
    })
    expect(cat.status).toBe(201)
    categoryId = cat.body.data!.category.id

    const r = await req('POST', '/api/ai/transaction-parser', {
      cookie: cookieA,
      body: { text: 'NLHAPPY tadi makan ayam geprek 25000' },
    })
    expect(r.status).toBe(200)
    expect(r.body.data!.clarification).toBeNull()
    const preview = r.body.data!.preview
    happyPreview = preview.transaction
    expect(happyPreview).toMatchObject({
      type: 'expense',
      amount: '25000.00',
      accountId,
      transactionDate: TODAY,
    })
    expect(happyPreview.description).toContain('ayam geprek')
    expect(typeof happyPreview.categoryId).toBe('string')
    expect(Array.isArray(r.body.data!.preview.notes)).toBe(true)

    // A preview is NOT a mutation: confirmation is mandatory (golden rule 10).
    const txs = await req('GET', '/api/transactions', { cookie: cookieA })
    expect((txs.body.data!.transactions as any[]).filter((t) => t.description?.includes('ayam geprek'))).toHaveLength(0)
  })

  it('records the transaction through TransactionService when the user confirms (idempotent)', async () => {
    const key = `ai-nl-happy-${suffix}`
    const first = await req('POST', '/api/transactions', { cookie: cookieA, body: { ...happyPreview, idempotencyKey: key } })
    expect(first.status).toBe(201)
    const firstId = first.body.data!.transaction.id

    const replay = await req('POST', '/api/transactions', { cookie: cookieA, body: { ...happyPreview, idempotencyKey: key } })
    expect(replay.status).toBe(200)
    expect(replay.body.data!.deduplicated).toBe(true)
    expect(replay.body.data!.transaction.id).toBe(firstId)

    const txs = await req('GET', '/api/transactions', { cookie: cookieA })
    expect((txs.body.data!.transactions as any[]).filter((t) => t.description?.includes('ayam geprek'))).toHaveLength(1)
  })

  it('lets the user edit parsed values before confirming', async () => {
    const parsed = await req('POST', '/api/ai/transaction-parser', {
      cookie: cookieA,
      body: { text: 'NLEDIT beli pulsa 20000' },
    })
    expect(parsed.status).toBe(200)
    expect(parsed.body.data!.preview.transaction.amount).toBe('20000.00')

    const saved = await req('POST', '/api/transactions', {
      cookie: cookieA,
      body: { ...parsed.body.data!.preview.transaction, amount: '35000.00', description: 'Pulsa listrik', idempotencyKey: `ai-nl-edit-${suffix}` },
    })
    expect(saved.status).toBe(201)
    expect(saved.body.data!.transaction.amount).toBe('35000.00')
    expect(saved.body.data!.transaction.description).toBe('Pulsa listrik')
  })

  it('asks a clarification question for ambiguous notes instead of guessing', async () => {
    const r = await req('POST', '/api/ai/transaction-parser', {
      cookie: cookieA,
      body: { text: 'BLANK_AMOUNT bayar' },
    })
    expect(r.status).toBe(200)
    expect(r.body.data!.preview).toBeNull()
    expect(r.body.data!.clarification.question).toContain('berapa')
    const txs = await req('GET', '/api/transactions', { cookie: cookieA })
    expect((txs.body.data!.transactions as any[]).some((t) => t.description === 'bayar')).toBe(false)
  })

  it('normalizes provider failures to safe API errors (no secrets, no stacks, no provider bodies)', async () => {
    const cases: Array<[string, number, string]> = [
      ['makan 1000 MALFORMED_REPLY', 503, 'AI_UNAVAILABLE'],
      ['makan 1000 EMPTY_CHOICES', 503, 'AI_UNAVAILABLE'],
      ['makan 1000 PROVIDER_ERROR', 503, 'AI_UNAVAILABLE'],
      ['makan 1000 RATE_LIMITED', 429, 'RATE_LIMITED'],
    ]
    for (const [text, status, code] of cases) {
      const r = await req('POST', '/api/ai/transaction-parser', { cookie: cookieA, body: { text } })
      expect(r.status).toBe(status)
      expect(r.body.error?.code).toBe(code)
      const raw = JSON.stringify(r.body)
      expect(raw).not.toContain('mock provider exploded')
      expect(raw).not.toContain('rate limited by mock provider')
      expect(raw).not.toMatch(/at .*\.ts:\d+/)
    }
  })

  it('validates the parser request (400)', async () => {
    const r = await req('POST', '/api/ai/transaction-parser', { cookie: cookieA, body: { text: '' } })
    expect(r.status).toBe(400)
    expect(r.body.error?.code).toBe('VALIDATION_ERROR')
  })

  it('never fabricates a preview when the user has no account', async () => {
    const r = await req('POST', '/api/ai/transaction-parser', {
      cookie: cookieB,
      body: { text: 'makan 10000 di warung' },
    })
    expect(r.status).toBe(200)
    expect(r.body.data!.preview).toBeNull()
    expect(r.body.data!.clarification.question).toContain('akun')
  })
})

describe('Phase 15 - Ask Your Finances', () => {
  it('answers from server-computed context and persists the conversation', async () => {
    const r = await req('POST', '/api/ai/ask', { cookie: cookieA, body: { question: 'Bagaimana pengeluaran saya?' } })
    expect(r.status).toBe(200)
    expect(r.body.data!.deterministic).toBe(false)
    expect(typeof r.body.data!.answer).toBe('string')
    expect(r.body.data!.answer.length).toBeGreaterThan(0)
    conversationId = r.body.data!.conversationId

    const list = await req('GET', '/api/ai/conversations', { cookie: cookieA })
    expect((list.body.data!.items as any[]).some((c) => c.id === conversationId)).toBe(true)

    const detail = await req('GET', `/api/ai/conversations/${conversationId}`, { cookie: cookieA })
    expect(detail.status).toBe(200)
    expect(detail.body.data!.messages).toHaveLength(2)
    expect(detail.body.data!.messages[0].role).toBe('user')
    expect(detail.body.data!.messages[0].content).toContain('Bagaimana pengeluaran saya?')
    expect(detail.body.data!.messages[1].role).toBe('assistant')
  })

  it('continues the same conversation on follow-up questions', async () => {
    const r = await req('POST', '/api/ai/ask', {
      cookie: cookieA,
      body: { question: 'Lalu berapa saldo saya?', conversationId },
    })
    expect(r.status).toBe(200)
    expect(r.body.data!.conversationId).toBe(conversationId)
    const detail = await req('GET', `/api/ai/conversations/${conversationId}`, { cookie: cookieA })
    expect(detail.body.data!.messages).toHaveLength(4)
  })

  it('denies cross-user conversation access (404, no data leak)', async () => {
    const r = await req('GET', `/api/ai/conversations/${conversationId}`, { cookie: cookieB })
    expect(r.status).toBe(404)
  })

  it('answers deterministically when there is no data to explain (no AI call)', async () => {
    const r = await req('POST', '/api/ai/ask', { cookie: cookieB, body: { question: 'Berapa total tabungan saya?' } })
    expect(r.status).toBe(200)
    expect(r.body.data!.deterministic).toBe(true)
    expect(r.body.data!.answer).toContain('Belum ada data')
  })

  it('validates ask input (400) and foreign conversation ids (404)', async () => {
    const long = await req('POST', '/api/ai/ask', { cookie: cookieA, body: { question: 'x'.repeat(1001) } })
    expect(long.status).toBe(400)
    const foreign = await req('POST', '/api/ai/ask', {
      cookie: cookieB,
      body: { question: 'halo', conversationId },
    })
    expect(foreign.status).toBe(404)
  })
})

describe('Phase 16 - deterministic forecast', () => {
  it('projects 30/60/90 day horizons deterministically from server data', async () => {
    const balance = ((await req('GET', `/api/accounts/${accountId}`, { cookie: cookieA })).body.data!.account.balance as string)
    for (const days of [30, 60, 90]) {
      const r = await req('GET', `/api/forecast?days=${days}`, { cookie: cookieA })
      expect(r.status).toBe(200)
      const f = r.body.data!.forecast
      expect(f.days).toBe(days)
      expect(f.projection.series).toHaveLength(days + 1)
      expect(f.projection.series[0].balance).toBe(balance)
      expect(typeof f.projection.projectedEndBalance).toBe('string')
      expect(f.projection.assumptions.length).toBeGreaterThan(0)
    }
    const a = await req('GET', '/api/forecast?days=30', { cookie: cookieA })
    const b = await req('GET', '/api/forecast?days=30', { cookie: cookieA })
    expect(JSON.stringify(a.body.data!.forecast)).toBe(JSON.stringify(b.body.data!.forecast))
  })

  it('validates the horizon (30/60/90 only)', async () => {
    expect((await req('GET', '/api/forecast?days=999', { cookie: cookieA })).status).toBe(400)
    expect((await req('GET', '/api/forecast?days=abc', { cookie: cookieA })).status).toBe(400)
  })

  it('handles a user with no history honestly (zero, stated assumptions)', async () => {
    const r = await req('GET', '/api/forecast?days=30', { cookie: cookieB })
    expect(r.status).toBe(200)
    const f = r.body.data!.forecast
    expect(f.projection.series).toHaveLength(31)
    expect(f.projection.series[0].balance).toBe('0.00')
    expect(f.projection.projectedEndBalance).toBe('0.00')
    expect((f.projection.assumptions as string[]).some((x) => x.includes('Belum ada cukup riwayat'))).toBe(true)
  })
})

describe('Phase 17 - recurring transactions', () => {
  it("rejects templates referencing another user's account (404)", async () => {
    const r = await req('POST', '/api/recurring', {
      cookie: cookieB,
      body: { type: 'expense', accountId, categoryId: null, amount: '9000.00', description: 'stolen', frequency: 'daily', nextDueDate: TODAY },
    })
    expect(r.status).toBe(404)
  })

  it('generates occurrences idempotently through TransactionService', async () => {
    const created = await req('POST', '/api/recurring', {
      cookie: cookieA,
      body: { type: 'expense', accountId, categoryId, amount: '15000.00', description: 'Kopi harian', frequency: 'daily', nextDueDate: TODAY },
    })
    expect(created.status).toBe(201)
    recurringId = created.body.data!.recurring.id
    expect(created.body.data!.recurring.isActive).toBe(true)
    expect(created.body.data!.recurring.amount).toBe('15000.00')

    const first = await req('POST', '/api/recurring/process', { cookie: cookieA, body: {} })
    expect(first.status).toBe(200)
    expect(first.body.data!.result.created).toBe(1)
    expect(first.body.data!.result.skipped).toBe(0)

    // Re-running is a no-op: occurrence keys dedupe inside TransactionService.
    const second = await req('POST', '/api/recurring/process', { cookie: cookieA, body: {} })
    expect(second.status).toBe(200)
    expect(second.body.data!.result.created).toBe(0)

    const txs = await req('GET', `/api/transactions?search=${encodeURIComponent('Kopi harian')}`, { cookie: cookieA })
    expect((txs.body.data!.transactions as any[]).filter((t) => t.description === 'Kopi harian')).toHaveLength(1)
  })

  it('updates a template and pauses it without destroying history', async () => {
    const upd = await req('PATCH', `/api/recurring/${recurringId}`, { cookie: cookieA, body: { amount: '16000.00' } })
    expect(upd.status).toBe(200)
    expect(upd.body.data!.recurring.amount).toBe('16000.00')

    const pause = await req('PATCH', `/api/recurring/${recurringId}`, { cookie: cookieA, body: { isActive: false } })
    expect(pause.status).toBe(200)
    expect(pause.body.data!.recurring.isActive).toBe(false)

    const run = await req('POST', '/api/recurring/process', { cookie: cookieA, body: {} })
    expect(run.body.data!.result.created).toBe(0)

    const list = await req('GET', '/api/recurring', { cookie: cookieA })
    const item = (list.body.data!.items as any[]).find((i) => i.id === recurringId)
    expect(item.isActive).toBe(false) // row kept, not destroyed (PRD §32)
  })

  it('enforces ownership on deactivation (foreign 404, owner 200)', async () => {
    const foreign = await req('DELETE', `/api/recurring/${recurringId}`, { cookie: cookieB })
    expect(foreign.status).toBe(404)
    const own = await req('DELETE', `/api/recurring/${recurringId}`, { cookie: cookieA })
    expect(own.status).toBe(200)
  })

  it("rejects templates pointing at another user's category (server-side validation)", async () => {
    const accB = await req('POST', '/api/accounts', {
      cookie: cookieB,
      body: { name: `B Bank ${suffix}`, type: 'bank', initialBalance: '100000' },
    })
    expect(accB.status).toBe(201)
    const r = await req('POST', '/api/recurring', {
      cookie: cookieB,
      body: { type: 'expense', accountId: accB.body.data!.account.id, categoryId, amount: '5000.00', description: 'x', frequency: 'weekly', nextDueDate: TODAY },
    })
    expect(r.status).toBe(400) // assertCategoryUsable: category not visible to this user
    expect(r.body.error?.code).toBe('VALIDATION_ERROR')
  })
})

describe('Phase 17 - bills', () => {
  it('derives status from the due date and pays via TransactionService (idempotent key)', async () => {
    const created = await req('POST', '/api/bills', {
      cookie: cookieA,
      body: { name: 'Internet', amount: '350000.00', dueDate: addDaysIso(TODAY, 2), accountId, categoryId },
    })
    expect(created.status).toBe(201)
    billId = created.body.data!.bill.id
    expect(created.body.data!.bill.status).toBe('due_soon')
    expect(created.body.data!.bill.paidAt).toBeNull()

    const before = toCents(((await req('GET', `/api/accounts/${accountId}`, { cookie: cookieA })).body.data!.account.balance) as string)
    const paid = await req('POST', `/api/bills/${billId}/pay`, { cookie: cookieA, body: {} })
    expect(paid.status).toBe(200)
    expect(paid.body.data!.bill.status).toBe('paid')
    expect(paid.body.data!.bill.paidAt).toBeTruthy()
    expect(paid.body.data!.deduplicated).toBe(false)
    expect(typeof paid.body.data!.transactionId).toBe('string')

    const after = toCents(((await req('GET', `/api/accounts/${accountId}`, { cookie: cookieA })).body.data!.account.balance) as string)
    expect(after).toBe(before - toCents('350000.00')) // exact BigInt cents, no floats

    const again = await req('POST', `/api/bills/${billId}/pay`, { cookie: cookieA, body: {} })
    expect(again.status).toBe(409)
    expect(again.body.error?.code).toBe('CONFLICT')

    const txs = await req('GET', `/api/transactions?search=Internet`, { cookie: cookieA })
    const internet = (txs.body.data!.transactions as any[]).filter((t) => t.description === 'Internet')
    expect(internet).toHaveLength(1) // exactly one expense, never doubled
    expect(internet[0].amount).toBe('350000.00')
    expect(internet[0].type).toBe('expense')
  })

  it('enforces bill ownership (foreign 404)', async () => {
    expect((await req('PATCH', `/api/bills/${billId}`, { cookie: cookieB, body: { amount: '1.00' } })).status).toBe(404)
    expect((await req('DELETE', `/api/bills/${billId}`, { cookie: cookieB })).status).toBe(404)
    expect((await req('POST', `/api/bills/${billId}/pay`, { cookie: cookieB, body: {} })).status).toBe(404)
  })

  it('filters by derived status and counts unpaid bills in the forecast', async () => {
    const list = await req('GET', '/api/bills', { cookie: cookieA })
    expect(list.status).toBe(200)
    expect((list.body.data!.items as any[]).find((b) => b.id === billId).status).toBe('paid')

    const overdue = await req('GET', '/api/bills?status=overdue', { cookie: cookieA })
    expect(overdue.status).toBe(200)
    expect((overdue.body.data!.items as any[]).every((b) => b.status === 'overdue')).toBe(true)

    const sewa = await req('POST', '/api/bills', {
      cookie: cookieA,
      body: { name: 'Sewa', amount: '1000000.00', dueDate: addDaysIso(TODAY, 2), accountId, categoryId },
    })
    expect(sewa.status).toBe(201)

    const forecast = await req('GET', '/api/forecast?days=30', { cookie: cookieA })
    expect(forecast.status).toBe(200)
    // paid Internet excluded, unpaid Sewa included — deterministic, server-side
    expect(forecast.body.data!.forecast.bills.total).toBe('1000000.00')
  })

  it('deletes the unpaid test bill (owner only)', async () => {
    const sewaList = await req('GET', '/api/bills', { cookie: cookieA })
    const sewa = (sewaList.body.data!.items as any[]).find((b) => b.name === 'Sewa')
    const r = await req('DELETE', `/api/bills/${sewa.id}`, { cookie: cookieA })
    expect(r.status).toBe(200)
    expect(r.body.data!.deleted).toBe(true)
  })
})
