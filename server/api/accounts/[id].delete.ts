import { getRouterParam } from 'h3'
import { apiHandler } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { archiveAccount } from '../../services/accounts/service'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const id = getRouterParam(event, 'id') ?? ''
  const account = await archiveAccount(event, auth.user.id, id)
  return { account }
})
