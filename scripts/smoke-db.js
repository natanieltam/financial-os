/* Dev smoke check: connectivity, app-user permissions, NUMERIC exactness, cascade.
 * Run: node scripts/smoke-db.js  (requires .env DATABASE_URL + local PG running) */
import { Pool } from 'pg'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const env = fs.readFileSync(path.join(dir, '..', '.env'), 'utf8')
const url = env.match(/DATABASE_URL=(.*)/)?.[1]?.trim()
if (!url) {
  console.error('DATABASE_URL not found in .env')
  process.exit(1)
}

const pool = new Pool({ connectionString: url })
const c = await pool.connect()
try {
  const u = await c.query(
    'insert into users (email, password_hash, name) values ($1, $2, $3) returning id',
    ['smoke@test.local', 'placeholder-not-a-real-hash', 'Smoke'],
  )
  const uid = u.rows[0].id
  const a = await c.query(
    'insert into accounts (user_id, name, type, initial_balance) values ($1,$2,$3,$4) returning id, initial_balance',
    [uid, 'Smoke Cash', 'cash', '1234567.89'],
  )
  console.log('initial_balance roundtrip (string, exact):', a.rows[0].initial_balance)
  const sum = await c.query(
    'select (initial_balance + 0.11) as total from accounts where id = $1',
    [a.rows[0].id],
  )
  console.log('NUMERIC math in DB (exact):', sum.rows[0].total)
  await c.query('delete from users where id = $1', [uid])
  const gone = await c.query('select count(*)::int as n from accounts where user_id = $1', [uid])
  console.log('cascade delete ok, accounts left:', gone.rows[0].n)
  console.log('SMOKE_DB_OK')
} finally {
  c.release()
  await pool.end()
}
