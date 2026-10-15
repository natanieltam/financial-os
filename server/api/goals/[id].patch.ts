import { getRouterParam, readBody } from 'h3'
import { apiHandler, requireUuidParam } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { goalUpdateSchema } from '../../../shared/schemas/finance'
import { updateGoal } from '../../services/goals/service'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const id = requireUuidParam(getRouterParam(event, 'id'))
  const input = goalUpdateSchema.parse(await readBody(event))
  const goal = await updateGoal(event, auth.user.id, id, input)
  return { goal }
})
