import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  // Animated pages (30fps tween + software WebGL) are CPU-heavy —
  // sequential workers keep runs stable
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    // System Chrome — no browser download needed locally or in CI
    channel: 'chrome',
    headless: true,
    launchOptions: {
      // Software WebGL for MapLibre in headless environments
      args: ['--enable-unsafe-swiftshader'],
    },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
