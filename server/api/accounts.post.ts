import { readBody, setResponseStatus } from 'h3'
import { apiHandler } from '../utils/api'
import { requireUser } from '../utils/auth'
import { accountCreateSchema } from '../../shared/schemas/finance'
import { createAccount } from '../services/accounts/service'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const input = accountCreateSchema.parse(await readBody(event))
  const account = await createAccount(event, auth.user.id, input)
  setResponseStatus(event, 201)
  return { account }
})
