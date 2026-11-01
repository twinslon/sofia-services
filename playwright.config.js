import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1280, height: 800 },
    // CI pins Chrome for Testing via CHROME_PATH (see deploy.yml); local
    // runs use the system Chrome stable
    channel: process.env.CHROME_PATH ? undefined : 'chrome',
    headless: true,
    launchOptions: {
      executablePath: process.env.CHROME_PATH || undefined,
      // Software WebGL for MapLibre in headless environments
      args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
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
