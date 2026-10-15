import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { moneyFlowType } from './enums'
import { users } from './users'

/**
 * PRD §18 — categories.
 * user_id NULL means system (default) category. Users archive, never hard-delete
 * categories referenced by transactions (FK on transactions is ON DELETE SET NULL).
 */
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    type: moneyFlowType('type').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    isArchived: boolean('is_archived').notNull().default(false),
    icon: text('icon'),
    color: text('color'),
    sortOrder: integer('sort_order').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('categories_user_idx').on(t.userId), index('categories_parent_idx').on(t.parentId)],
)
