import { getRouterParam, readBody } from 'h3'
import { apiHandler, requireUuidParam } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { billUpdateSchema } from '../../../shared/schemas/finance'
import { updateBill } from '../../services/bills/service'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const id = requireUuidParam(getRouterParam(event, 'id'))
  const input = billUpdateSchema.parse(await readBody(event))
  const bill = await updateBill(auth.user.id, id, input)
  return { bill }
})
