import { afterEach, describe, expect, it, vi } from 'vitest'
import { AIProviderError } from '../server/services/ai/ai.types'
import { ApiError } from '../server/utils/api'
import { transactionIntentSchema } from '../server/services/ai/ai.schemas'
import { parseIntentFromResponse, providerErrorToApiError } from '../server/services/ai/ai.service'
import { resolvePreview } from '../server/services/ai/parser'
import { KenariProvider } from '../server/services/ai/providers/kenari.provider'
import { computeBillStatus } from '../server/services/bills/service'
import { occurrenceDate } from '../server/services/recurring/service'
import { projectForecast } from '../server/services/forecast/projection'

// Nitro's runtime bundle uses virtual imports (#nitro-internal-virtual/*) that
// only resolve inside a running Nitro app; unit tests only need the config
// accessor, so stub the runtime module for this file.
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({ kenari: {} }) }))

/**
 * Unit tests for Phases 12-17: provider abstraction + error normalization,
 * structured AI output validation, business validation of parsed intents,
 * bill status derivation, recurring occurrence math and the deterministic
 * forecast core. No external provider is contacted; the provider layer is
 * tested through an injected fetch stub only (never faked as real success).
 */

const ACCOUNTS = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'BCA' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'GoPay' },
]
const CATEGORIES = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Makan', type: 'expense' as const },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Gaji', type: 'income' as const },
]

function intent(over: Record<string, unknown>) {
  return {
    type: 'expense',
    amount: null,
    description: null,
    category: null,
    account: null,
    date: null,
    confidence: 'low',
    needsClarification: false,
    clarificationQuestion: null,
    ...over,
  } as unknown as Parameters<typeof resolvePreview>[0]
}

const ctx = (over: Record<string, unknown> = {}) => ({
  accounts: ACCOUNTS,
  categories: CATEGORIES,
  today: new Date('2026-10-15T12:00:00.000Z'),
  ...over,
})

describe('AI provider abstraction (Phase 12/13)', () => {
  afterEach(() => vi.unstubAllGlobals())

  const provider = () =>
    new KenariProvider({ baseUrl: 'https://kenari.test/v1', apiKey: 'secret-key-123', model: 'test-model', timeoutMs: 5000 })

  function stubFetch(handler: () => Promise<Response>): void {
    vi.stubGlobal('fetch', vi.fn(handler))
  }

  it('parses a valid OpenAI-compatible chat completion response', async () => {
    stubFetch(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"type":"expense"}' } }], model: 'test-model' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const res = await provider().chat({ messages: [{ role: 'user', content: 'hi' }] })
    expect(res.content).toBe('{"type":"expense"}')
    expect(res.provider).toBe('kenari')
    expect(res.model).toBe('test-model')
  })

  it('sends normalized OpenAI-compatible requests with the configured model', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await provider().chat({ messages: [{ role: 'user', content: 'hello' }], temperature: 0.2, maxTokens: 123 })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://kenari.test/v1/chat/completions')
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('test-model')
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }])
    expect(body.temperature).toBe(0.2)
    expect(body.max_tokens).toBe(123)
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret-key-123')
  })

  it('normalizes 429 to rate_limited without leaking credentials', async () => {
    stubFetch(async () => new Response('rate limited', { status: 429 }))
    const err = await provider().chat({ messages: [] }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AIProviderError)
    expect((err as AIProviderError).kind).toBe('rate_limited')
    expect(JSON.stringify(err)).not.toContain('secret-key-123')
  })

  it('normalizes 401/403/404/network failure to unavailable', async () => {
    for (const setup of [
      () => stubFetch(async () => new Response('bad key', { status: 401 })),
      () => stubFetch(async () => new Response('forbidden', { status: 403 })),
      () => stubFetch(async () => new Response('missing', { status: 404 })),
      () =>
        stubFetch(async () => {
          throw new TypeError('fetch failed')
        }),
    ]) {
      setup()
      const err = await provider().chat({ messages: [] }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(AIProviderError)
      expect((err as AIProviderError).kind).toBe('unavailable')
      expect(String((err as AIProviderError).message)).not.toContain('secret-key-123')
    }
  })

  it('normalizes abort/timeout to unavailable', async () => {
    stubFetch(async () => {
      throw new DOMException('The operation timed out.', 'AbortError')
    })
    const err = await provider().chat({ messages: [] }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AIProviderError)
    expect((err as AIProviderError).kind).toBe('unavailable')
  })

  it('normalizes 5xx and malformed JSON body to malformed', async () => {
    stubFetch(async () => new Response('<html>oops</html>', { status: 500, headers: { 'content-type': 'text/html' } }))
    const e1 = await provider().chat({ messages: [] }).catch((e: unknown) => e)
    expect((e1 as AIProviderError).kind).toBe('malformed')

    stubFetch(async () => new Response('not json at all', { status: 200 }))
    const e2 = await provider().chat({ messages: [] }).catch((e: unknown) => e)
    expect((e2 as AIProviderError).kind).toBe('malformed')
  })

  it('normalizes an empty choices array to malformed', async () => {
    stubFetch(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }))
    const err = await provider().chat({ messages: [] }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AIProviderError)
    expect((err as AIProviderError).kind).toBe('malformed')
  })

  it('maps provider errors to safe API errors: rate_limited -> 429, malformed -> 503 AI_UNAVAILABLE', () => {
    const limited = providerErrorToApiError(new AIProviderError('rate_limited', 'Too many'))
    expect((limited as ApiError).statusCode).toBe(429)
    expect((limited as ApiError).code).toBe('RATE_LIMITED')
    const unavailable = providerErrorToApiError(new AIProviderError('unavailable', 'down'))
    expect((unavailable as ApiError).statusCode).toBe(503)
    expect((unavailable as ApiError).code).toBe('AI_UNAVAILABLE')
    const malformed = providerErrorToApiError(new AIProviderError('malformed', 'garbage'))
    expect((malformed as ApiError).statusCode).toBe(503)
    expect((malformed as ApiError).code).toBe('AI_UNAVAILABLE')
    expect((malformed as ApiError).message).not.toContain('garbage')
    expect(providerErrorToApiError(new Error('plain'))).toBeInstanceOf(Error)
  })
})

describe('structured AI output validation (Phase 12/14)', () => {
  it('accepts a valid intent JSON', () => {
    const parsed = parseIntentFromResponse(
      JSON.stringify({
        type: 'expense',
        amount: '25000',
        description: 'ayam geprek',
        category: 'Makan',
        account: 'BCA',
        date: null,
        confidence: 'high',
      }),
    )
    expect(parsed.type).toBe('expense')
    expect(parsed.amount).toBe('25000')
  })

  it('tolerates markdown fences around the JSON', () => {
    expect(parseIntentFromResponse('```json\n{"type":"income","amount":"1500000","confidence":"high"}\n```').type).toBe('income')
  })

  it('rejects malformed AI output with a safe 503 error', () => {
    for (const bad of ['not json', '{}', '{"type":"invest"}']) {
      let caught: unknown
      try {
        parseIntentFromResponse(bad)
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(ApiError)
      expect((caught as ApiError).statusCode).toBe(503)
      expect((caught as ApiError).code).toBe('AI_UNAVAILABLE')
    }
  })

  it('rejects unknown transaction types and invalid confidence', () => {
    expect(() => transactionIntentSchema.parse({ type: 'invest', amount: '1000', confidence: 'high' })).toThrow()
    expect(() => transactionIntentSchema.parse({ type: 'expense', amount: '1000', confidence: 'sure' })).toThrow()
  })
})

describe('parser business validation (Phase 14)', () => {
  it('resolves a valid expense with matching account + category hints into a preview', () => {
    const r = resolvePreview(
      intent({ type: 'expense', amount: '25000', description: 'ayam geprek', category: 'Makan', account: 'BCA', confidence: 'high' }),
      ctx(),
    )
    expect(r.clarification).toBeNull()
    expect(r.preview).not.toBeNull()
    expect(r.preview!.transaction).toMatchObject({
      type: 'expense',
      amount: '25000.00',
      accountId: ACCOUNTS[0]!.id,
      categoryId: CATEGORIES[0]!.id,
      transactionDate: '2026-10-15',
      description: 'ayam geprek',
    })
  })

  it('keeps large plain income amounts (1500000 = 1.5 juta)', () => {
    const r = resolvePreview(intent({ type: 'income', amount: '1500000', account: 'BCA', category: 'Gaji', date: '2026-10-01', confidence: 'high' }), ctx())
    expect(r.preview!.transaction.amount).toBe('1500000.00')
    expect(r.preview!.transaction.categoryId).toBe(CATEGORIES[1]!.id)
    expect(r.preview!.transaction.transactionDate).toBe('2026-10-01')
  })

  it('asks for clarification on ambiguous amount ("bayar" with null amount)', () => {
    const r = resolvePreview(intent({ description: 'bayar', needsClarification: true, clarificationQuestion: 'Berapa jumlahnya?' }), ctx())
    expect(r.preview).toBeNull()
    expect(r.clarification!.question).toContain('Berapa')
  })

  it('asks for clarification when amount is missing even if AI forgot the flag', () => {
    const r = resolvePreview(intent({}), ctx())
    expect(r.preview).toBeNull()
    expect(r.clarification!.question).toContain('berapa')
  })

  it('rejects invalid amounts (zero/negative/garbage) with clarification', () => {
    for (const amount of ['0', '-5000', 'abc']) {
      expect(resolvePreview(intent({ amount }), ctx()).preview).toBeNull()
    }
  })

  it('refuses to guess between multiple accounts (clarification lists them)', () => {
    const r = resolvePreview(intent({ amount: '10000' }), ctx())
    expect(r.preview).toBeNull()
    expect(r.clarification!.question).toContain('BCA')
    expect(r.clarification!.question).toContain('GoPay')
  })

  it('auto-selects the single account and says so in the notes', () => {
    const r = resolvePreview(intent({ amount: '10000', account: 'Tidak Ada' }), ctx({ accounts: [ACCOUNTS[1]!] }))
    expect(r.preview!.transaction.accountId).toBe(ACCOUNTS[1]!.id)
    expect(r.preview!.notes.some((n) => n.includes('hanya ada satu akun'))).toBe(true)
  })

  it('resolves an exact account hint by name (case-insensitive)', () => {
    const r = resolvePreview(intent({ amount: '10000', account: 'gopay' }), ctx())
    expect(r.preview!.transaction.accountId).toBe(ACCOUNTS[1]!.id)
  })

  it('falls back to the default category with an explicit note (never silently invented)', () => {
    const r = resolvePreview(intent({ amount: '10000', account: 'BCA', category: 'Kopi Susu' }), ctx())
    expect(r.preview).not.toBeNull()
    expect(r.preview!.notes.some((n) => n.includes('Kopi Susu') && n.includes('tidak ditemukan'))).toBe(true)
  })

  it('falls back when a category hint contradicts the transaction type', () => {
    const r = resolvePreview(intent({ amount: '10000', account: 'BCA', category: 'Gaji' }), ctx())
    expect(r.preview!.transaction.categoryId).not.toBe(CATEGORIES[1]!.id) // income category on an expense
    expect(r.preview!.notes.some((n) => n.includes('tidak ditemukan'))).toBe(true)
  })

  it('clamps future dates to today with a note; nonsense dates also land on today', () => {
    const future = resolvePreview(intent({ amount: '10000', account: 'BCA', date: '2027-01-01' }), ctx())
    expect(future.preview!.transaction.transactionDate).toBe('2026-10-15')
    expect(future.preview!.notes.some((n) => n.includes('hari ini'))).toBe(true)

    const nonsense = resolvePreview(intent({ amount: '10000', account: 'BCA', date: 'kemarin' }), ctx())
    expect(nonsense.preview!.transaction.transactionDate).toBe('2026-10-15')
  })

  it('AI-flagged ambiguity wins even when an amount is present', () => {
    const r = resolvePreview(intent({ amount: '50000', needsClarification: true, clarificationQuestion: 'Mau catat ke akun yang mana?' }), ctx())
    expect(r.preview).toBeNull()
    expect(r.clarification!.question).toContain('akun')
  })

  it('asks the user to create an account first when none exist (never invents an account)', () => {
    const r = resolvePreview(intent({ amount: '10000' }), ctx({ accounts: [] }))
    expect(r.preview).toBeNull()
    expect(r.clarification!.question).toContain('akun')
  })
})

describe('bill status derivation (Phase 17)', () => {
  const today = new Date('2026-10-15T12:00:00.000Z')
  it('derives paid / overdue / due_soon / upcoming deterministically', () => {
    expect(computeBillStatus({ status: 'upcoming', dueDate: '2026-10-01', paidAt: null }, today)).toBe('overdue')
    expect(computeBillStatus({ status: 'upcoming', dueDate: '2026-10-17', paidAt: null }, today)).toBe('due_soon')
    expect(computeBillStatus({ status: 'upcoming', dueDate: '2026-11-01', paidAt: null }, today)).toBe('upcoming')
    expect(computeBillStatus({ status: 'upcoming', dueDate: '2026-11-01', paidAt: today }, today)).toBe('paid')
    expect(computeBillStatus({ status: 'paid', dueDate: '2026-10-01', paidAt: null }, today)).toBe('paid')
  })
})

describe('recurring occurrence math (Phase 17)', () => {
  it('steps daily/weekly/monthly/yearly correctly', () => {
    expect(occurrenceDate(new Date('2026-10-15T12:00:00.000Z'), 'daily', 1).toISOString().slice(0, 10)).toBe('2026-10-16')
    expect(occurrenceDate(new Date('2026-10-15T12:00:00.000Z'), 'weekly', 2).toISOString().slice(0, 10)).toBe('2026-10-29')
    expect(occurrenceDate(new Date('2026-10-31T12:00:00.000Z'), 'monthly', 1).toISOString().slice(0, 10)).toBe('2026-11-30')
    expect(occurrenceDate(new Date('2026-02-28T12:00:00.000Z'), 'monthly', 1).toISOString().slice(0, 10)).toBe('2026-03-28')
    expect(occurrenceDate(new Date('2026-02-28T12:00:00.000Z'), 'yearly', 1).toISOString().slice(0, 10)).toBe('2027-02-28')
  })
})

describe('deterministic forecast core (Phase 16)', () => {
  it('projects recurring + bills + baseline with BigInt cents (no floats)', () => {
    const result = projectForecast({
      startingBalance: '1000000.00',
      recurring: [
        { amount: '500000.00', type: 'income', occurrences: ['2026-10-20'] },
        { amount: '100000.00', type: 'expense', occurrences: ['2026-10-21', '2026-10-22'] },
      ],
      bills: [{ amount: '250000.00', dueDate: '2026-10-25' }],
      baselineDailyExpense: '10000.00',
      days: 30,
      asOf: '2026-10-15',
    })
    expect(result.recurringIncomeTotal).toBe('500000.00')
    expect(result.recurringExpenseTotal).toBe('200000.00')
    expect(result.billsTotal).toBe('250000.00')
    expect(result.baselineTotal).toBe('300000.00')
    // 1.000.000 + 500.000 - 200.000 - 250.000 - 300.000
    expect(result.projectedEndBalance).toBe('750000.00')
    expect(result.willBeNegative).toBe(false)
    expect(result.series).toHaveLength(31) // asOf + 30 days
    expect(result.series[0]).toEqual({ date: '2026-10-15', balance: '1000000.00' })
  })

  it('applies items dated today immediately', () => {
    const result = projectForecast({
      startingBalance: '100000.00',
      recurring: [],
      bills: [{ amount: '30000.00', dueDate: '2026-10-15' }],
      baselineDailyExpense: null,
      days: 5,
      asOf: '2026-10-15',
    })
    expect(result.series[0]!.balance).toBe('70000.00')
    expect(result.projectedEndBalance).toBe('70000.00')
  })

  it('flags negative projections', () => {
    const result = projectForecast({
      startingBalance: '50000.00',
      recurring: [],
      bills: [],
      baselineDailyExpense: '10000.00',
      days: 10,
      asOf: '2026-10-15',
    })
    expect(result.projectedEndBalance).toBe('-50000.00')
    expect(result.willBeNegative).toBe(true)
  })

  it('handles no-history input honestly (no baseline, stated assumption)', () => {
    const result = projectForecast({
      startingBalance: '0.00',
      recurring: [],
      bills: [],
      baselineDailyExpense: null,
      days: 30,
      asOf: '2026-10-15',
    })
    expect(result.baselineTotal).toBeNull()
    expect(result.projectedEndBalance).toBe('0.00')
    expect(result.assumptions.some((a) => a.includes('Belum ada cukup riwayat'))).toBe(true)
  })
})
