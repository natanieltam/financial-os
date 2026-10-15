import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema/index'

export type Database = NodePgDatabase<typeof schema>

let pool: Pool | undefined
let database: Database | undefined

/**
 * Lazy singleton server-side DB client.
 * The frontend NEVER talks to PostgreSQL (PRD golden rule 1).
 */
export function getDatabase(): Database {
  if (database) return database
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not configured')
  pool = new Pool({ connectionString: url, max: 10 })
  database = drizzle(pool, { schema })
  return database
}
