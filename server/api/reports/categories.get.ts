import { getQuery } from 'h3'
import { z } from 'zod'
import { apiHandler } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { categoryReport } from '../../services/reports/service'

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const query = querySchema.parse(getQuery(event))
  const asOf = new Date()
  const toExclusive = query.to
    ? new Date(`${query.to}T00:00:00.000Z`)
    : new Date(asOf.getTime() + 86_400_000)
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1)
  const from = query.from
    ? new Date(`${query.from}T00:00:00.000Z`)
    : new Date(toExclusive.getTime() - 30 * 86_400_000)
  const report = await categoryReport(auth.user.id, from, toExclusive)
  return report
})
