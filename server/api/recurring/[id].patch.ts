import { getRouterParam, readBody } from 'h3'
import { apiHandler, requireUuidParam } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { recurringUpdateSchema } from '../../../shared/schemas/finance'
import { updateRecurring } from '../../services/recurring/service'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const id = requireUuidParam(getRouterParam(event, 'id'))
  const input = recurringUpdateSchema.parse(await readBody(event))
  const recurring = await updateRecurring(auth.user.id, id, input)
  return { recurring }
})
