import { defineConfig } from 'drizzle-kit'

// drizzle-kit reads DATABASE_URL from .env automatically.
export default defineConfig({
  schema: './db/schema/index.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
})
