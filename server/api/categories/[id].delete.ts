import { getRouterParam } from 'h3'
import { apiHandler } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { deleteCategory } from '../../services/categories/service'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const id = getRouterParam(event, 'id') ?? ''
  const result = await deleteCategory(event, auth.user.id, id)
  return result
})
