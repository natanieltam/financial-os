import { readBody, setResponseStatus } from 'h3'
import { apiHandler } from '../utils/api'
import { requireUser } from '../utils/auth'
import { budgetCreateSchema } from '../../shared/schemas/finance'
import { createBudget } from '../services/budgets/service'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const input = budgetCreateSchema.parse(await readBody(event))
  const budget = await createBudget(event, auth.user.id, input)
  setResponseStatus(event, 201)
  return { budget }
})
