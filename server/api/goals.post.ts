import { readBody, setResponseStatus } from 'h3'
import { apiHandler } from '../utils/api'
import { requireUser } from '../utils/auth'
import { goalCreateSchema } from '../../shared/schemas/finance'
import { createGoal } from '../services/goals/service'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const input = goalCreateSchema.parse(await readBody(event))
  const goal = await createGoal(event, auth.user.id, input)
  setResponseStatus(event, 201)
  return { goal }
})
