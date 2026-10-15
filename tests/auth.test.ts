import { afterAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'http://127.0.0.1:3100'
const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
const email = (label: string) => `auth-test-${label}-${suffix}@example.com`
const PASSWORD = 'Sup3rSecret!pw'

interface UserPayload {
  id: string
  email: string
  name?: string
  passwordHash?: string
  [key: string]: unknown
}

interface Envelope {
  success: boolean
  data?: { user?: UserPayload }
  error?: { code: string; message: string }
}

async function post(pathName: string, body: unknown, cookie?: string) {
  const res = await fetch(`${BASE}${pathName}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  })
  const setCookies = res.headers.getSetCookie?.() ?? []
  const session = setCookies.find((c) => c.startsWith('finos_session='))
  return {
    status: res.status,
    setCookies,
    cookie: session ? session.split(';')[0] : undefined,
    body: (await res.json()) as Envelope,
  }
}

async function me(cookie?: string) {
  const res = await fetch(`${BASE}/api/me`, {
    headers: cookie ? { cookie } : {},
  })
  return { status: res.status, body: (await res.json()) as Envelope }
}

afterAll(async () => {
  // clean up test users created in the development database
  const env = fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8')
  const url = env.match(/DATABASE_URL=(.*)/)?.[1]?.trim()
  if (!url) return
  const pool = new Pool({ connectionString: url })
  await pool.query("delete from users where email like 'auth-test-%@example.com'")
  await pool.end()
})

describe('registration', () => {
  it('registers successfully, sets HttpOnly session cookie, returns safe user', async () => {
    const res = await post('/api/auth/register', {
      email: email('reg'),
      password: PASSWORD,
      name: 'Reg Test',
    })
    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data?.user?.email).toBe(email('reg'))
    expect(res.body.data?.user?.passwordHash).toBeUndefined()
    expect(res.cookie).toBeDefined()
    const raw = res.setCookies.join(' | ')
    expect(raw).toContain('HttpOnly')
    expect(raw).toContain('SameSite=Lax')
    expect(raw.toLowerCase()).toContain('secure') // Secure in production build
  })

  it('rejects duplicate email with CONFLICT and no internals', async () => {
    await post('/api/auth/register', { email: email('dup'), password: PASSWORD })
    const res = await post('/api/auth/register', { email: email('dup'), password: PASSWORD })
    expect(res.status).toBe(409)
    expect(res.body.error?.code).toBe('CONFLICT')
    expect(res.body.error?.message).not.toMatch(/sql|stack|postgres|\\/i)
  })

  it('rejects weak password with VALIDATION_ERROR', async () => {
    const res = await post('/api/auth/register', { email: email('weak'), password: 'short' })
    expect(res.status).toBe(400)
    expect(res.body.error?.code).toBe('VALIDATION_ERROR')
  })
})

describe('login', () => {
  it('logs in with valid credentials and sets session cookie', async () => {
    await post('/api/auth/register', { email: email('login'), password: PASSWORD })
    const res = await post('/api/auth/login', { email: email('login'), password: PASSWORD })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data?.user?.email).toBe(email('login'))
    expect(res.cookie).toBeDefined()
  })

  it('rejects invalid password with generic UNAUTHORIZED message', async () => {
    await post('/api/auth/register', { email: email('badpw'), password: PASSWORD })
    const res = await post('/api/auth/login', {
      email: email('badpw'),
      password: 'WrongPassword1!',
    })
    expect(res.status).toBe(401)
    expect(res.body.error?.code).toBe('UNAUTHORIZED')
    expect(res.body.error?.message).toBe('Invalid email or password')
  })

  it('rejects unknown email with the same generic message (no enumeration)', async () => {
    const res = await post('/api/auth/login', {
      email: `nobody-${suffix}@example.com`,
      password: 'Whatever123!',
    })
    expect(res.status).toBe(401)
    expect(res.body.error?.message).toBe('Invalid email or password')
  })
})

describe('protected routes', () => {
  it('GET /api/me returns the authenticated user from the session', async () => {
    await post('/api/auth/register', { email: email('me'), password: PASSWORD })
    const login = await post('/api/auth/login', { email: email('me'), password: PASSWORD })
    const res = await me(login.cookie)
    expect(res.status).toBe(200)
    expect(res.body.data?.user?.email).toBe(email('me'))
  })

  it('returns 401 UNAUTHORIZED when unauthenticated', async () => {
    const res = await me()
    expect(res.status).toBe(401)
    expect(res.body.error?.code).toBe('UNAUTHORIZED')
  })

  it('never accepts client-provided user_id as identity', async () => {
    const res = await fetch(`${BASE}/api/me?user_id=someone-else`, { method: 'GET' })
    expect(res.status).toBe(401)
  })
})

describe('logout & session invalidation', () => {
  it('logout revokes the session — old cookie no longer works', async () => {
    await post('/api/auth/register', { email: email('out'), password: PASSWORD })
    const login = await post('/api/auth/login', { email: email('out'), password: PASSWORD })
    expect((await me(login.cookie)).status).toBe(200)

    const out = await post('/api/auth/logout', {}, login.cookie)
    expect(out.status).toBe(200)
    expect(out.body.success).toBe(true)

    const after = await me(login.cookie)
    expect(after.status).toBe(401)
  })
})

describe('rate limiting', () => {
  it('rate-limits repeated failed logins (429 RATE_LIMITED)', async () => {
    const target = email('rl')
    await post('/api/auth/register', { email: target, password: PASSWORD })

    const statuses: number[] = []
    for (let i = 0; i < 5; i++) {
      const res = await post('/api/auth/login', { email: target, password: 'WrongPass123!' })
      statuses.push(res.status)
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401])

    const sixth = await post('/api/auth/login', { email: target, password: 'WrongPass123!' })
    expect(sixth.status).toBe(429)
    expect(sixth.body.error?.code).toBe('RATE_LIMITED')
  })
})
