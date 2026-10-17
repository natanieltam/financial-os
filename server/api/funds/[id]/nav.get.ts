import { getQuery } from 'h3'
import { z } from 'zod'
import { apiHandler } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { getFundById, getFundNavHistory } from '../../../services/mutual_funds/service'

const navQuerySchema = z.object({
  fundId: z.string().uuid(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
})

export default apiHandler(async (event) => {
  requireUser(event)
  const query = navQuerySchema.parse(getQuery(event))

  const fund = await getFundById(query.fundId)
  if (!fund) {
    return { navHistory: [] }
  }

  const navHistory = await getFundNavHistory(query)
  return { navHistory }
})