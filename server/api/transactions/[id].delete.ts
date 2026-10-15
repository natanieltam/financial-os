import { getRouterParam } from 'h3'
import { apiHandler, requireUuidParam } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { deleteTransaction } from '../../services/transactions/service'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const id = requireUuidParam(getRouterParam(event, 'id'))
  const result = await deleteTransaction(event, auth.user.id, id)
  return result
})
