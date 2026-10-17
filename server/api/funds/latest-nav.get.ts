import { getQuery } from 'h3'
import { z } from 'zod'
import { apiHandler } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { getFundsWithLatestNav } from '../../services/mutual_funds/service'

const querySchema = z.object({
  type: z.string().optional(),
  currency: z.string().optional(),
  sharia: z.enum(['true', 'false']).optional(),
  tradable: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
})

export default apiHandler(async (event) => {
  requireUser(event)
  const query = querySchema.parse(getQuery(event))

  const funds = await getFundsWithLatestNav({ ...query, limit: query.limit ?? 50 })
  return { funds }
})