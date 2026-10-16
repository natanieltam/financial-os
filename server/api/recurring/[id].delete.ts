import { getRouterParam } from 'h3'
import { apiHandler, requireUuidParam } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { deactivateRecurring } from '../../services/recurring/service'

/** Deactivation only (PRD §32): the template row and history are preserved. */
export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const id = requireUuidParam(getRouterParam(event, 'id'))
  const recurring = await deactivateRecurring(auth.user.id, id)
  return { recurring }
})
