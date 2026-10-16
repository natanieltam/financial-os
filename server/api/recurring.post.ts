import { readBody, setResponseStatus } from 'h3'
import { apiHandler } from '../utils/api'
import { requireUser } from '../utils/auth'
import { recurringCreateSchema } from '../../shared/schemas/finance'
import { createRecurring } from '../services/recurring/service'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const input = recurringCreateSchema.parse(await readBody(event))
  const recurring = await createRecurring(auth.user.id, input)
  setResponseStatus(event, 201)
  return { recurring }
})
