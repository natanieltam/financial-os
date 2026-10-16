import { getQuery } from 'h3'
import { apiHandler } from '../utils/api'
import { requireUser } from '../utils/auth'
import { listRecurring } from '../services/recurring/service'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const query = getQuery(event)
  const activeOnly = query.active === '1' || query.active === 'true'
  return { items: await listRecurring(auth.user.id, { activeOnly }) }
})
