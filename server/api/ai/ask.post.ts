import { readBody } from 'h3'
import { apiHandler } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { rateLimitUser } from '../../utils/rateLimit'
import { aiAskRequestSchema } from '../../../shared/schemas/finance'
import { askFinances } from '../../services/ai/ask'

/** Ask Your Finances (Phase 15). Context is built server-side first (PRD §38–§39). */
export default apiHandler(async (event) => {
  const auth = requireUser(event)
  rateLimitUser(event, auth.user.id, 'ai:ask', 15, 60_000)
  const input = aiAskRequestSchema.parse(await readBody(event))
  const result = await askFinances(event, auth.user.id, input)
  return result
})
