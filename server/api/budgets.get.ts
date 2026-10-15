import { getQuery } from 'h3'
import { z } from 'zod'
import { apiHandler } from '../utils/api'
import { requireUser } from '../utils/auth'
import { listBudgets } from '../services/budgets/service'

const querySchema = z.object({
  includeArchived: z.enum(['0', '1', 'true', 'false']).optional(),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const query = querySchema.parse(getQuery(event))
  const budgets = await listBudgets(auth.user.id, {
    includeArchived: query.includeArchived === '1' || query.includeArchived === 'true',
    asOf: query.asOf ? new Date(`${query.asOf}T12:00:00.000Z`) : undefined,
  })
  return { budgets }
})
