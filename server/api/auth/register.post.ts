import { readBody, setResponseStatus } from 'h3'
import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { getDatabase } from '../../../db/client'
import { users } from '../../../db/schema/index'
import { apiErrors, apiHandler } from '../../utils/api'
import { audit } from '../../utils/audit'
import { createSession, type AuthUser } from '../../utils/auth'
import { hashPassword } from '../../utils/password'
import { rateLimit } from '../../utils/rateLimit'

const registerSchema = z.object({
  email: z.email().min(3).max(254),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  name: z.string().trim().max(100).optional().default(''),
})

export default apiHandler(async (event) => {
  rateLimit(event, 'register', 10, 60_000)

  const body = registerSchema.parse(await readBody(event))
  const email = body.email.toLowerCase()

  const db = getDatabase()
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1)
  if (existing.length > 0) {
    throw apiErrors.conflict('An account with this email already exists')
  }

  const passwordHash = await hashPassword(body.password)
  let created: AuthUser
  try {
    const inserted = await db
      .insert(users)
      .values({ email, passwordHash, name: body.name })
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        currency: users.currency,
        timezone: users.timezone,
        createdAt: users.createdAt,
      })
    created = inserted[0]!
  } catch (err) {
    // 23505 = unique_violation (concurrent duplicate registration)
    if ((err as { code?: string })?.code === '23505') {
      throw apiErrors.conflict('An account with this email already exists')
    }
    throw err
  }

  await createSession(event, created.id)
  await audit(event, 'account_created', {
    userId: created.id,
    entityType: 'user',
    entityId: created.id,
  })
  setResponseStatus(event, 201)
  return { user: created }
})
