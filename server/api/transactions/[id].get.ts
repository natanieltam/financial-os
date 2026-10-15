import { getRouterParam } from 'h3'
import { apiHandler, requireUuidParam } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { getTransaction } from '../../services/transactions/service'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const id = requireUuidParam(getRouterParam(event, 'id'))
  const transaction = await getTransaction(auth.user.id, id)
  return { transaction }
})
