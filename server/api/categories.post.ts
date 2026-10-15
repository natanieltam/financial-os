import { readBody, setResponseStatus } from 'h3'
import { apiHandler } from '../utils/api'
import { requireUser } from '../utils/auth'
import { categoryCreateSchema } from '../../shared/schemas/finance'
import { createCategory } from '../services/categories/service'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const input = categoryCreateSchema.parse(await readBody(event))
  const category = await createCategory(event, auth.user.id, input)
  setResponseStatus(event, 201)
  return { category }
})
