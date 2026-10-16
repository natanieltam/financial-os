import { spawn, type ChildProcess } from 'node:child_process'
import http from 'node:http'
import fs, { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 3100
const BASE = `http://127.0.0.1:${PORT}`

let server: ChildProcess | undefined
let mockProvider: http.Server | undefined
const logs: string[] = []

/**
 * Local OpenAI-compatible test double (port 3199). The spawned server's
 * KENARI_BASE_URL points here so Phases 12-15 can be exercised end-to-end
 * deterministically. This is an explicit test fixture - it never stands in
 * for a real Kenari success in application code.
 */
function startMockProvider(): http.Server {
  const mock = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c: Buffer) => (raw += c.toString()))
    req.on('end', () => {
      if (req.url !== '/v1/chat/completions') {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'not found' } }))
        return
      }
      let payload: { model?: string; messages?: Array<{ role: string; content: string }> } = {}
      try {
        payload = JSON.parse(raw)
      } catch {
        /* ignore */
      }
      const messages = payload.messages ?? []
      const system = messages.find((m) => m.role === 'system')?.content ?? ''
      const user = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
      const replyJson = (content: string, status = 200) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            id: 'mock-1',
            model: payload.model ?? 'test-model',
            choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          }),
        )
      }

      // Failure markers (checked first) drive error-normalization tests.
      if (user.includes('RATE_LIMITED')) {
        res.writeHead(429, { 'content-type': 'text/plain' })
        res.end('rate limited by mock provider')
        return
      }
      if (user.includes('PROVIDER_ERROR')) {
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end('mock provider exploded')
        return
      }
      if (user.includes('EMPTY_CHOICES')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ id: 'mock-1', model: payload.model ?? 'test-model', choices: [] }))
        return
      }
      if (user.includes('MALFORMED_REPLY')) {
        replyJson('this is not json at all')
        return
      }

      if (system.includes('transaction parser')) {
        // Deterministic intent: amount from the note (or null when flagged
        // ambiguous); never invents - mirrors the PRD clarification rules.
        const blank = user.includes('BLANK_AMOUNT')
        const m = user.match(/(?:amount=)?(\d{3,})/)
        const amount = blank ? null : (m ? m[1]! : null)
        const income = /\bgaji\b/i.test(user)
        replyJson(
          JSON.stringify({
            type: income ? 'income' : 'expense',
            amount,
            description: user.slice(0, 60),
            category: amount === null ? null : income ? null : 'Groceries',
            account: 'Bank Utama',
            date: null,
            confidence: amount ? 'high' : 'low',
            needsClarification: amount === null,
            clarificationQuestion: amount === null ? 'Jumlah transaksinya berapa?' : null,
          }),
        )
        return
      }

      // Ask Your Finances flow.
      replyJson(JSON.stringify({ answer: 'Berdasarkan konteks finansial yang diberikan, semua angka berasal dari data server.' }))
    })
  })
  mock.listen(3199, '127.0.0.1')
  return mock
}

export async function setup(): Promise<void> {
  mockProvider = startMockProvider()
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
      // Point the AI layer at the local test double (deterministic; the real
      // KENARI_* values from .env are intentionally overridden here only).
      KENARI_BASE_URL: 'http://127.0.0.1:3199/v1',
      KENARI_API_KEY: 'test-key',
      KENARI_MODEL: 'test-model',
      // Nitro applies NUXT_-prefixed vars to runtime config at boot; plain
      // KENARI_* alone cannot override values baked into the build.
      NUXT_KENARI_BASE_URL: 'http://127.0.0.1:3199/v1',
      NUXT_KENARI_API_KEY: 'test-key',
      NUXT_KENARI_MODEL: 'test-model',
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
  mockProvider?.close()
}
