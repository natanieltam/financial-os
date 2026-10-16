/* eslint-disable @typescript-eslint/no-explicit-any -- raw API envelope assertions */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Phase 18 security hardening tests against the built server (PRD \xa712-\xa718,
 * \xa759 audit actions, \xa761 password-operation rate limit, \xa7102 CSRF).
 */
const BASE = 'http://127.0.0.1:3100'
const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
const EMAIL = `finos-sec-${suffix}@example.com`
const PASSWORD = 'Sup3rSecret!pw'
const NEW_PASSWORD = 'N3v3rGuess!me'

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

async function login(email: string, password: string): Promise<Res> {
  return req('POST', '/api/auth/login', { body: { email, password } })
}

let cookie1 = ''

beforeAll(async () => {
  const r = await req('POST', '/api/auth/register', {
    body: { email: EMAIL, password: PASSWORD, name: 'Sec User' },
  })
  expect(r.status).toBe(201)
  cookie1 = r.cookie ?? (await login(EMAIL, PASSWORD)).cookie!
  expect(cookie1).toBeTruthy()
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
      await pool.query('delete from audit_logs where user_id = $1', [id])
      await pool.query('delete from sessions where user_id = $1', [id])
      await pool.query('delete from users where id = $1', [id])
    }
  } finally {
    await pool.end()
  }
})

describe('Phase 18 - security headers (PRD \xa713)', () => {
  it('sets nosniff / frame-deny / referrer-policy on HTML responses', async () => {
    const res = await fetch(`${BASE}/login`)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('referrer-policy')).toBe('same-origin')
  })

  it('sets security headers on API error responses too', async () => {
    const res = await fetch(`${BASE}/api/me`)
    expect(res.status).toBe(401)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })
})

describe('Phase 18 - CSRF origin defense (PRD \xa7102)', () => {
  it('rejects cross-origin state-changing requests with 403', async () => {
    const r = await req('POST', '/api/auth/login', {
      body: { email: EMAIL, password: PASSWORD },
      headers: { origin: 'https://evil.example.com' },
    })
    expect(r.status).toBe(403)
    expect(r.body.error?.code).toBe('FORBIDDEN')
  })

  it('allows same-origin state-changing requests', async () => {
    const r = await req('POST', '/api/auth/login', {
      body: { email: EMAIL, password: PASSWORD },
      headers: { origin: BASE },
    })
    expect(r.status).toBe(200)
  })

  it('does not block safe methods with a foreign Origin', async () => {
    const r = await req('GET', '/api/me', { headers: { origin: 'https://evil.example.com' } })
    expect(r.status).toBe(401) // unauthenticated, but not CSRF-rejected
  })
})

describe('Phase 18 - password change (PRD \xa759 audit + \xa761 limit + session invalidation)', () => {
  it('succeeds, revokes OTHER sessions, keeps current device, audits the action', async () => {
    const other = await login(EMAIL, PASSWORD)
    expect(other.status).toBe(200)
    const otherCookie = other.cookie!

    const ok = await req('POST', '/api/auth/password', {
      cookie: cookie1,
      body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    })
    expect(ok.status).toBe(200)
    expect(ok.body.data).toEqual({ changed: true })

    // Current device stays signed in.
    const me1 = await req('GET', '/api/me', { cookie: cookie1 })
    expect(me1.status).toBe(200)
    // The other session is invalidated server-side.
    const me2 = await req('GET', '/api/me', { cookie: otherCookie })
    expect(me2.status).toBe(401)
    expect(me2.body.error?.code).toBe('UNAUTHORIZED')

    // Old password no longer works; new one does.
    const old = await login(EMAIL, PASSWORD)
    expect(old.status).toBe(401)
    const fresh = await login(EMAIL, NEW_PASSWORD)
    expect(fresh.status).toBe(200)
    cookie1 = fresh.cookie!

    // Audit row (PRD \xa759 password_change).
    const env = fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8')
    const url = env.match(/DATABASE_URL=(.*)/)?.[1]?.trim()
    const pool = new Pool({ connectionString: url })
    try {
      const { rows } = await pool.query(
        "select count(*)::int as n from audit_logs where action = 'password_change' and user_id = (select id from users where email = $1)",
        [EMAIL],
      )
      expect(rows[0].n).toBeGreaterThanOrEqual(1)
    } finally {
      await pool.end()
    }
  }, 30_000)

  it('rejects a wrong current password without changing anything', async () => {
    const r = await req('POST', '/api/auth/password', {
      cookie: cookie1,
      body: { currentPassword: 'Totally-Wrong-1!', newPassword: 'Another!Pass9' },
    })
    expect(r.status).toBe(400)
    expect(r.body.error?.code).toBe('VALIDATION_ERROR')
    const still = await login(EMAIL, NEW_PASSWORD)
    expect(still.status).toBe(200) // password unchanged
    cookie1 = still.cookie!
  }, 30_000)

  it('enforces the password-operation rate limit (5 / 15 min, PRD \xa761)', async () => {
    // Earlier tests already consumed part of the shared bucket; hammer until 429
    // and assert the limiter shape (no stack leaks, RATE_LIMITED code).
    let sawLimit = false
    for (let i = 0; i < 8; i += 1) {
      const r = await req('POST', '/api/auth/password', {
        cookie: cookie1,
        body: { currentPassword: 'Wrong-Current-1!', newPassword: 'Whatever!Pass1' },
      })
      if (r.status === 429) {
        sawLimit = true
        expect(r.body.error?.code).toBe('RATE_LIMITED')
        expect(JSON.stringify(r.body)).not.toMatch(/stack|Error:|at .*\(/)
        break
      }
    }
    expect(sawLimit).toBe(true)
  }, 30_000)
})

describe('Phase 18 - error responses never leak internals (PRD \xa715)', () => {
  it('returns a clean envelope for malformed ids and invalid bodies', async () => {
    const badId = await req('GET', '/api/accounts/not-a-uuid', { cookie: cookie1 })
    expect(badId.status).toBe(404)
    expect(badId.body.error?.code).toBe('NOT_FOUND')
    const raw = JSON.stringify(badId.body)
    expect(raw).not.toMatch(/SELECT |pg_|drizzle|node_modules|\.ts:/)

    const badBody = await req('POST', '/api/accounts', { cookie: cookie1, body: { name: '', type: 'nope' } })
    expect(badBody.status).toBe(400)
    expect(badBody.body.error?.code).toBe('VALIDATION_ERROR')
    expect(JSON.stringify(badBody.body)).not.toMatch(/SELECT |drizzle|node_modules|\.ts:/)
  })
})
