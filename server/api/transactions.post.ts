import { getHeader, readBody, setResponseStatus } from 'h3'
import { apiHandler } from '../utils/api'
import { requireUser } from '../utils/auth'
import { transactionCreateSchema } from '../../shared/schemas/finance'
import { createTransaction } from '../services/transactions/service'
import { rateLimit } from '../utils/rateLimit'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  rateLimit(event, 'tx:mutate', 120, 60_000) // PRD §61: transaction mutations
  // Double-click/retry protection: header or body idempotency key (PRD §22).
  const headerKey = getHeader(event, 'idempotency-key')
  const body = transactionCreateSchema.parse(await readBody(event))
  if (!body.idempotencyKey && headerKey) body.idempotencyKey = headerKey
  const result = await createTransaction(event, auth.user.id, body)
  setResponseStatus(event, result.deduplicated ? 200 : 201)
  return result
})
