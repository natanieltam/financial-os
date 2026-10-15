import { getDatabase } from '../../db/client'
import { auditLogs } from '../../db/schema/index'
import { clientIp } from './rateLimit'
import type { H3Event } from 'h3'

/**
 * Append an audit entry (PRD §59). Never logs secrets or full request bodies;
 * failures never break the request.
 */
export async function audit(
  event: H3Event | null,
  action: string,
  fields: {
    userId?: string | null
    entityType?: string
    entityId?: string
    metadata?: Record<string, unknown>
  } = {},
): Promise<void> {
  try {
    await getDatabase()
      .insert(auditLogs)
      .values({
        action,
        userId: fields.userId ?? null,
        entityType: fields.entityType ?? null,
        entityId: fields.entityId ?? null,
        metadata: fields.metadata ?? null,
        ip: event ? clientIp(event) : null,
      })
  } catch (err) {
    console.error('[audit] insert failed:', action, err)
  }
}
