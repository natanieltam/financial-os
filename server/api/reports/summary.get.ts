import { getQuery } from 'h3'
import { z } from 'zod'
import { apiHandler } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { summaryReport } from '../../services/reports/service'

const querySchema = z.object({
  period: z.enum(['7d', '30d', '90d', '1m', '3m', '6m', '1y']).default('30d'),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const query = querySchema.parse(getQuery(event))
  const asOf = query.asOf ? new Date(`${query.asOf}T12:00:00.000Z`) : new Date()
  const summary = await summaryReport(auth.user.id, query.period, asOf)
  return summary
})
