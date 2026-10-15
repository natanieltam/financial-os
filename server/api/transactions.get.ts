import { getQuery } from 'h3'
import { apiHandler } from '../utils/api'
import { requireUser } from '../utils/auth'
import { transactionListQuerySchema } from '../../shared/schemas/finance'
import { listTransactions } from '../services/transactions/service'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const query = transactionListQuerySchema.parse(getQuery(event))
  const result = await listTransactions(auth.user.id, query)
  return result
})
