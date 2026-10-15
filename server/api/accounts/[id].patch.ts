import { getRouterParam, readBody } from 'h3'
import { apiHandler, requireUuidParam } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { accountUpdateSchema } from '../../../shared/schemas/finance'
import { updateAccount } from '../../services/accounts/service'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const id = requireUuidParam(getRouterParam(event, 'id'))
  const input = accountUpdateSchema.parse(await readBody(event))
  const account = await updateAccount(event, auth.user.id, id, input)
  return { account }
})
