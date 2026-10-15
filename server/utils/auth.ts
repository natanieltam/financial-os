import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { deleteCookie, getCookie, setCookie, type H3Event } from 'h3'
import { and, eq, isNull, gt } from 'drizzle-orm'
import { useRuntimeConfig } from 'nitropack/runtime'
import { getDatabase } from '../../db/client'
import { sessions, users } from '../../db/schema/index'
import { apiErrors } from './api'

export { fakeVerify, hashPassword, verifyPassword } from './password'

export const SESSION_COOKIE = 'finos_session'
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days

/** Safe user shape — never includes password_hash (PRD §13, §15). */
export interface AuthUser {
  id: string
  email: string
  name: string
  currency: string
  timezone: string
  createdAt: Date
}

export interface AuthContext {
  user: AuthUser
  sessionId: string
}

declare module 'h3' {
  interface H3EventContext {
    auth?: AuthContext | null
  }
}

const userColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  currency: users.currency,
  timezone: users.timezone,
  createdAt: users.createdAt,
}

export function sessionSecret(event: H3Event): string {
  let secret = ''
  try {
    secret = useRuntimeConfig(event).sessionSecret || ''
  } catch {
    /* fall back to explicit env */
  }
  secret ||= process.env.SESSION_SECRET || ''
  if (!secret) throw new Error('SESSION_SECRET is not configured')
  return secret
}

function hashToken(event: H3Event, token: string): string {
  return createHmac('sha256', sessionSecret(event)).update(token).digest('hex')
}

export async function createSession(event: H3Event, userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000)
  await getDatabase()
    .insert(sessions)
    .values({ userId, tokenHash: hashToken(event, token), expiresAt })
  setCookie(event, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

/** Resolve the authenticated user from the session cookie (server-side only). */
export async function loadSessionUser(event: H3Event): Promise<AuthContext | null> {
  try {
    const token = getCookie(event, SESSION_COOKIE)
    if (!token) return null
    const tokenHash = hashToken(event, token)
    const db = getDatabase()
    const rows = await db
      .select({ user: userColumns, sessionId: sessions.id, expiresAt: sessions.expiresAt })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (!row) return null
    void db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.id, row.sessionId))
      .then(undefined, (err: unknown) => console.error('[auth] lastSeenAt update failed:', err))
    return { user: row.user, sessionId: row.sessionId }
  } catch (err) {
    console.error('[auth] session lookup failed:', err)
    return null
  }
}

/** Revoke the current session and clear the cookie (logout / invalidation). */
export async function revokeSession(event: H3Event): Promise<void> {
  const token = getCookie(event, SESSION_COOKIE)
  if (token) {
    try {
      await getDatabase()
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.tokenHash, hashToken(event, token)), isNull(sessions.revokedAt)))
    } catch (err) {
      console.error('[auth] session revoke failed:', err)
    }
  }
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
}

/**
 * Authorization primitive: derive identity from the server-side session,
 * NEVER from client-provided user_id (PRD §15, golden rule 13).
 */
export function requireUser(event: H3Event): AuthContext {
  const auth = event.context.auth
  if (!auth) throw apiErrors.unauthorized()
  return auth
}

export function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}
