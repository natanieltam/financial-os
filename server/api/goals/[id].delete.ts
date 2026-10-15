import { getRouterParam } from 'h3'
import { apiHandler, requireUuidParam } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { deleteGoal } from '../../services/goals/service'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const id = requireUuidParam(getRouterParam(event, 'id'))
  const result = await deleteGoal(event, auth.user.id, id)
  return result
})
