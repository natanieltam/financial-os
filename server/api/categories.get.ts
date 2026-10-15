import { getQuery } from 'h3'
import { z } from 'zod'
import { apiHandler } from '../utils/api'
import { requireUser } from '../utils/auth'
import { listCategories } from '../services/categories/service'

const querySchema = z.object({
  type: z.enum(['income', 'expense']).optional(),
  includeArchived: z.enum(['0', '1', 'true', 'false']).optional(),
})

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const query = querySchema.parse(getQuery(event))
  const categories = await listCategories(auth.user.id, {
    type: query.type,
    includeArchived: query.includeArchived === '1' || query.includeArchived === 'true',
  })
  return { categories }
})
