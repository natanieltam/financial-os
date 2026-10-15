import { getQuery } from 'h3'
import { z } from 'zod'
import { apiHandler } from '../utils/api'
import { requireUser } from '../utils/auth'
import { listAccounts } from '../services/accounts/service'

const querySchema = z.object({
  includeArchived: z.enum(['0', '1', 'true', 'false']).optional(),
  type: z.string().optional(),
  search: z.string().trim().max(60).optional(),
})

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const query = querySchema.parse(getQuery(event))
  const includeArchived = query.includeArchived === '1' || query.includeArchived === 'true'
  const accounts = await listAccounts(auth.user.id, {
    includeArchived,
    type: query.type,
    search: query.search,
  })
  return { accounts }
})
