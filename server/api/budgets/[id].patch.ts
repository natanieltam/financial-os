import { getRouterParam, readBody } from 'h3'
import { apiHandler } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { budgetUpdateSchema } from '../../../shared/schemas/finance'
import { updateBudget } from '../../services/budgets/service'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const id = getRouterParam(event, 'id') ?? ''
  const input = budgetUpdateSchema.parse(await readBody(event))
  const budget = await updateBudget(event, auth.user.id, id, input)
  return { budget }
})
