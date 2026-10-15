import { apiHandler } from '../../utils/api'
import { audit } from '../../utils/audit'
import { revokeSession } from '../../utils/auth'

/** Idempotent logout: revokes the current session and clears the cookie. */
export default apiHandler(async (event) => {
  const userId = event.context.auth?.user.id ?? null
  await revokeSession(event)
  if (userId) await audit(event, 'logout', { userId, entityType: 'session' })
  return {}
})
