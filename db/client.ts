import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { useRuntimeConfig } from 'nitropack/runtime'
import * as schema from './schema/index'

export type Database = NodePgDatabase<typeof schema>

let pool: Pool | undefined
let database: Database | undefined

function resolveDatabaseUrl(): string {
  // Explicit env (deployments/tests) wins; nitro runtimeConfig supports
  // NUXT_DATABASE_URL overrides and build-time .env defaults.
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  try {
    const url = useRuntimeConfig().databaseUrl
    if (url) return url
  } catch {
    // not running inside nitro — fall through
  }
  return ''
}

/**
 * Lazy singleton server-side DB client.
 * The frontend NEVER talks to PostgreSQL (PRD golden rule 1).
 */
export function getDatabase(): Database {
  if (database) return database
  const url = resolveDatabaseUrl()
  if (!url) throw new Error('DATABASE_URL is not configured')
  pool = new Pool({ connectionString: url, max: 10 })
  database = drizzle(pool, { schema })
  return database
}
