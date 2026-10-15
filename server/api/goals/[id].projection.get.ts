import { getQuery, getRouterParam } from 'h3'
import { apiHandler } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { goalProjectionSchema } from '../../../shared/schemas/finance'
import { projectGoal } from '../../services/goals/service'

/** Deterministic what-if projection (PRD §31) — no AI involvement. */
export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const id = getRouterParam(event, 'id') ?? ''
  const { monthlyContribution } = goalProjectionSchema.parse({
    monthlyContribution: getQuery(event).monthlyContribution,
  })
  const projection = await projectGoal(auth.user.id, id, monthlyContribution)
  return { projection }
})
