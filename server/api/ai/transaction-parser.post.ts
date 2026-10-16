import { readBody } from 'h3'
import { apiHandler } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { rateLimitUser } from '../../utils/rateLimit'
import { aiParseRequestSchema } from '../../../shared/schemas/finance'
import { parseTransactionNote } from '../../services/ai/transactionParser'

/**
 * Natural-language transaction parsing (Phase 14). NEVER mutates: returns a
 * preview the user edits/confirms (confirmation goes through the standard
 * POST /api/transactions -> TransactionService path).
 */
export default apiHandler(async (event) => {
  const auth = requireUser(event)
  rateLimitUser(event, auth.user.id, 'ai:parse', 10, 60_000)
  const { text } = aiParseRequestSchema.parse(await readBody(event))
  const result = await parseTransactionNote(event, auth.user.id, text)
  return result
})
