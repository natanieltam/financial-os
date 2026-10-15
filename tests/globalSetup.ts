import { spawn, type ChildProcess } from 'node:child_process'
import fs, { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 3100
const BASE = `http://127.0.0.1:${PORT}`

let server: ChildProcess | undefined
const logs: string[] = []

export async function setup(): Promise<void> {
  const entry = path.join(root, '.output', 'server', 'index.mjs')
  if (!existsSync(entry)) {
    throw new Error(`Built server not found (${entry}). Run: npm run build`)
  }
  const dotenv: Record<string, string> = {}
  try {
    const raw = fs.readFileSync(path.join(root, '.env'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m) dotenv[m[1]!] = m[2]!.trim()
    }
  } catch {
    /* no .env */
  }
  server = spawn(process.execPath, [entry], {
    cwd: root,
    env: {
      ...process.env,
      ...dotenv,
      PORT: String(PORT),
      NITRO_PORT: String(PORT),
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout?.on('data', (d: Buffer) => logs.push(d.toString()))
  server.stderr?.on('data', (d: Buffer) => logs.push(d.toString()))

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Server exited early (${server.exitCode}):\n${logs.join('')}`)
    }
    try {
      const res = await fetch(`${BASE}/api/me`)
      if (res.status === 401 || res.status === 200) return // ready
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`Server did not become ready on :${PORT}\n${logs.join('')}`)
}

export async function teardown(): Promise<void> {
  await new Promise((r) => setTimeout(r, 200))
  console.log('=== SERVER LOGS ===')
  console.log(logs.join('') || '(no server logs)')
  server?.kill()
}
