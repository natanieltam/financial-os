import { getRouterParam } from 'h3'
import { apiHandler, requireUuidParam } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { getOwnedConversation, listMessages } from '../../../services/ai/conversations'

/** Ownership-protected: User A can never read User B's conversation (404). */
export default apiHandler(async (event) => {
  const auth = requireUser(event)
  const id = requireUuidParam(getRouterParam(event, 'id'))
  const conversation = await getOwnedConversation(auth.user.id, id)
  return { conversation, messages: await listMessages(auth.user.id, id) }
})
