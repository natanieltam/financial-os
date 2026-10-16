import { getRouterParam } from 'h3'
import { apiHandler, requireUuidParam } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { payBill } from '../../../services/bills/service'

/**
 * Marks a bill paid AND records the real expense via TransactionService with
 * the deterministic `bill:{id}` idempotency key — safe to retry (Phase 17).
 */
export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const id = requireUuidParam(getRouterParam(event, 'id'))
  const result = await payBill(event, auth.user.id, id)
  return result
})
