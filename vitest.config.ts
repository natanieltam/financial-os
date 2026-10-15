import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
