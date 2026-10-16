import { getRouterParam, readBody } from 'h3'
import { apiHandler, requireUuidParam } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { transactionUpdateSchema } from '../../../shared/schemas/finance'
import { updateTransaction } from '../../services/transactions/service'
import { rateLimit } from '../../utils/rateLimit'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  rateLimit(event, 'tx:mutate', 120, 60_000) // PRD §61: transaction mutations
  const id = requireUuidParam(getRouterParam(event, 'id'))
  const input = transactionUpdateSchema.parse(await readBody(event))
  const transaction = await updateTransaction(event, auth.user.id, id, input)
  return { transaction }
})
