import { getRouterParam } from 'h3'
import { apiHandler } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { archiveBudget } from '../../services/budgets/service'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const id = getRouterParam(event, 'id') ?? ''
  const budget = await archiveBudget(event, auth.user.id, id)
  return { budget }
})
