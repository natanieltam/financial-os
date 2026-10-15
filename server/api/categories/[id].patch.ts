import { getRouterParam, readBody } from 'h3'
import { apiHandler, requireUuidParam } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { categoryUpdateSchema } from '../../../shared/schemas/finance'
import { updateCategory } from '../../services/categories/service'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const id = requireUuidParam(getRouterParam(event, 'id'))
  const input = categoryUpdateSchema.parse(await readBody(event))
  const category = await updateCategory(event, auth.user.id, id, input)
  return { category }
})
