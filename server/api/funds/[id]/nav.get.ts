import { getQuery, getRouterParam } from 'h3'
import { z } from 'zod'
import { apiHandler } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { getFundById, getFundNavSeries } from '../../../services/mutual_funds/service'

const navSeriesQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(3650).optional(),
})

export default apiHandler(async (event) => {
  requireUser(event)
  const fundId = getRouterParam(event, 'id') ?? ''
  const query = navSeriesQuerySchema.parse(getQuery(event))

  const fund = await getFundById(fundId)
  if (!fund) {
    return { navSeries: [] }
  }

  const navSeries = await getFundNavSeries(fundId, query.days ?? 365)
  return { navSeries }
})