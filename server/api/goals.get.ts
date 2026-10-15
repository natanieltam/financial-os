import { getQuery } from 'h3'
import { z } from 'zod'
import { apiHandler } from '../utils/api'
import { requireUser } from '../utils/auth'
import { listGoals } from '../services/goals/service'

const querySchema = z.object({
  includeArchived: z.enum(['0', '1', 'true', 'false']).optional(),
})

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const query = querySchema.parse(getQuery(event))
  const goals = await listGoals(auth.user.id, {
    includeArchived: query.includeArchived === '1' || query.includeArchived === 'true',
  })
  return { goals }
})
