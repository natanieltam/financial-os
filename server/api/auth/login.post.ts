import { readBody } from 'h3'
import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { getDatabase } from '../../../db/client'
import { users } from '../../../db/schema/index'
import { apiErrors, apiHandler } from '../../utils/api'
import { audit } from '../../utils/audit'
import { createSession, type AuthUser } from '../../utils/auth'
import { fakeVerify, verifyPassword } from '../../utils/password'
import { rateLimit, resetRateLimit } from '../../utils/rateLimit'

const loginSchema = z.object({
  email: z.email().min(3).max(254),
  password: z.string().min(1).max(128),
})

export default apiHandler(async (event) => {
  // Failed-login protection (PRD §14): IP-wide and per-account limits.
  rateLimit(event, 'login-ip', 20, 15 * 60_000)
  const body = loginSchema.parse(await readBody(event))
  const email = body.email.toLowerCase()
  rateLimit(event, `login:${email}`, 5, 15 * 60_000)

  const rows = await getDatabase()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      currency: users.currency,
      timezone: users.timezone,
      createdAt: users.createdAt,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1)
  const user = rows[0]

  if (!user) {
    await fakeVerify(body.password) // equalize timing — no user enumeration
    await audit(event, 'failed_login', { metadata: { email } })
    throw apiErrors.unauthorized('Invalid email or password')
  }

  const valid = await verifyPassword(user.passwordHash, body.password)
  if (!valid) {
    await audit(event, 'failed_login', { userId: user.id, metadata: { email } })
    throw apiErrors.unauthorized('Invalid email or password')
  }

  resetRateLimit(event, 'login-ip')
  resetRateLimit(event, `login:${email}`)

  const safeUser: AuthUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    currency: user.currency,
    timezone: user.timezone,
    createdAt: user.createdAt,
  }
  await createSession(event, user.id)
  await audit(event, 'login', { userId: user.id, entityType: 'session' })
  return { user: safeUser }
})
