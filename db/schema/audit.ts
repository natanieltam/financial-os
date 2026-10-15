import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './users'

/**
 * PRD §59 — audit logs. Append-only: no updated_at, no hard deletes.
 * user_id is SET NULL so the log outlives deleted users.
 * Never store secrets or full sensitive request bodies here.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    metadata: jsonb('metadata'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_user_created_idx').on(t.userId, t.createdAt.desc()),
    index('audit_logs_action_idx').on(t.action),
  ],
)
