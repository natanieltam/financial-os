import { getQuery } from 'h3'
import { z } from 'zod'
import { apiHandler } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { getMoneyMarketFunds } from '../../services/mutual_funds/service'

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
})

export default apiHandler(async (event) => {
  requireUser(event)
  const query = querySchema.parse(getQuery(event))

  return getMoneyMarketFunds(query.limit ?? 50)
})