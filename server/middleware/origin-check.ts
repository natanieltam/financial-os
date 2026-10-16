import { defineEventHandler, getHeader, getRequestURL, setResponseStatus } from 'h3'

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * CSRF strategy for the cookie-session architecture (PRD §102):
 * 1. Session cookie is SameSite=Lax + HttpOnly (+ Secure in production),
 *    so browsers do not attach it to cross-site form POSTs.
 * 2. Defense in depth: any state-changing request that carries an Origin
 *    header must be same-origin. Requests without an Origin header (curl,
 *    server-side clients, tests) pass — SameSite already blocks browsers,
 *    and our JSON API rejects cross-origin preflights because we never send
 *    CORS headers.
 */
export default defineEventHandler((event) => {
  if (!UNSAFE.has(event.method)) return
  const origin = getHeader(event, 'origin')
  if (!origin || origin === 'null') return
  const requestOrigin = new URL(getRequestURL(event)).origin
  if (origin !== requestOrigin) {
    setResponseStatus(event, 403)
    return {
      success: false,
      error: { code: 'FORBIDDEN', message: 'Cross-origin request rejected' },
    }
  }
})
