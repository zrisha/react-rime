import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: '**/smoke.spec.ts',
  timeout: 90_000,
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
  },
  webServer: {
    // Build first: preview serves example/dist, which otherwise goes stale
    // and silently tests old library code.
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
