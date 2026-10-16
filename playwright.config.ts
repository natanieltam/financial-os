import { defineConfig, devices } from '@playwright/test'

/**
 * Browser-level E2E (PRD §71). Drives the real built Nuxt production server in
 * a headless Chromium. Run `npm run build` first (webServer serves .output), or
 * let `npm run test:e2e` handle it. Financial mutations are asserted here only
 * for their UI effect; the authoritative behaviour is covered by the Vitest
 * suite (tests/*.test.ts) against the same server.
 */
const PORT = Number(process.env.E2E_PORT ?? 3300)
const baseURL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node .output/server/index.mjs',
    url: `${baseURL}/login`,
    reuseExistingServer: true,
    timeout: 60_000,
    env: { NODE_ENV: 'production', PORT: String(PORT), NITRO_PORT: String(PORT) },
  },
})
