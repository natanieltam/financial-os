import { apiHandler } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { listConversations } from '../../services/ai/conversations'

export default apiHandler(async (event) => {
  const auth = requireUser(event)
  return { items: await listConversations(auth.user.id) }
})
