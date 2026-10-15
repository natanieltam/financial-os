import { defineEventHandler } from 'h3'
import { loadSessionUser } from '../utils/auth'

/**
 * Server-side authentication middleware (PRD §14, §15).
 * Resolves the session cookie into event.context.auth for every request.
 * Never trusts client-provided user_id.
 */
export default defineEventHandler(async (event) => {
  event.context.auth = await loadSessionUser(event)
})
