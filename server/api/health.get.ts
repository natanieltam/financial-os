import { getQuery } from 'h3'
import { z } from 'zod'
import { apiHandler } from '../utils/api'
import { requireUser } from '../utils/auth'
import { computeHealthScore } from '../services/analytics/health'

const querySchema = z.object({
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

/** Financial Health Score (PRD §33) — deterministic, never AI-computed. */
export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const query = querySchema.parse(getQuery(event))
  const asOf = query.asOf ? new Date(`${query.asOf}T12:00:00.000Z`) : new Date()
  const health = await computeHealthScore(auth.user.id, asOf)
  return health
})
