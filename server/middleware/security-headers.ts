import { defineEventHandler, setResponseHeader } from 'h3'

/**
 * Baseline browser hardening headers (PRD §18, §102).
 * CSP is intentionally not set: Nuxt injects per-page scripts; a strict CSP
 * would require nonce plumbing and risks breaking hydration. CSRF is handled
 * separately in server/plugins/origin-check.ts + SameSite=Lax cookies.
 */
export default defineEventHandler((event) => {
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'X-Frame-Options', 'DENY')
  setResponseHeader(event, 'Referrer-Policy', 'same-origin')
  setResponseHeader(event, 'Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
})
