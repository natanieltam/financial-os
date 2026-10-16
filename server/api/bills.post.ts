import { readBody, setResponseStatus } from 'h3'
import { apiHandler } from '../utils/api'
import { requireUser } from '../utils/auth'
import { billCreateSchema } from '../../shared/schemas/finance'
import { createBill } from '../services/bills/service'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const input = billCreateSchema.parse(await readBody(event))
  const bill = await createBill(auth.user.id, input)
  setResponseStatus(event, 201)
  return { bill }
})
