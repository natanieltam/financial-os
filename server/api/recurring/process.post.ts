import { apiHandler } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { rateLimit } from '../../utils/rateLimit'
import { processRecurring } from '../../services/recurring/service'

/**
 * Generates transactions for all due occurrences (PRD §32). Idempotent:
 * re-running never duplicates — deterministic occurrence keys dedupe inside
 * TransactionService against the (userId, idempotency_key) unique index.
 */
export default apiHandler(async (event) => {
  const auth = requireUser(event)
  rateLimit(event, 'recurring:process', 10, 60_000)
  const result = await processRecurring(event, auth.user.id)
  return { result }
})
