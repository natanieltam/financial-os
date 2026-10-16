import { readBody } from 'h3'
import { z } from 'zod'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { apiHandler, apiErrors } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { hashPassword, verifyPassword } from '../../utils/password'
import { rateLimit } from '../../utils/rateLimit'
import { audit } from '../../utils/audit'
import { getDatabase } from '../../../db/client'
import { sessions, users } from '../../../db/schema/index'

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(128),
  newPassword: z.string().min(8, 'Password must be at least 8 characters').max(128),
})

/**
 * Change the authenticated user's password (PRD §59 password_change audit,
 * §61 password-operation rate limit). On success every OTHER session of the
 * user is revoked — the current device stays signed in, everywhere else is
 * logged out.
 */
export default apiHandler(async (event) => {
  const auth = requireUser(event)
  rateLimit(event, 'password-change', 5, 15 * 60_000)
  const body = passwordChangeSchema.parse(await readBody(event))

  const rows = await getDatabase()
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, auth.user.id))
    .limit(1)
  const user = rows[0]
  if (!user) throw apiErrors.unauthorized()

  const ok = await verifyPassword(user.passwordHash, body.currentPassword)
  if (!ok) throw apiErrors.validation('Current password is incorrect')

  await getDatabase()
    .update(users)
    .set({ passwordHash: await hashPassword(body.newPassword), updatedAt: new Date() })
    .where(eq(users.id, user.id))

  // Invalidate every other session (PRD §14/session invalidation).
  await getDatabase()
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt), ne(sessions.id, auth.sessionId)))

  await audit(event, 'password_change', { userId: user.id, entityType: 'user', entityId: user.id })
  return { changed: true }
})
