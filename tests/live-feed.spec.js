import { test, expect } from '@playwright/test'
import { expectNoErrors, headerStats, waitForApp } from './helpers.js'

test.describe('live feed', () => {
  test('connects, decodes and matches vehicles to lines', async ({ page }) => {
    await expectNoErrors(page, async () => {
      await waitForApp(page)

      const status = await page.textContent('.status')
      expect(status).toMatch(/vehicles · updated/)

      // Static network loaded
      const tagline = await page.textContent('.tagline')
      expect(tagline).toMatch(/^204 lines/)
    })
  })

  test('chip counts sum to the reported vehicle total', async ({ page }) => {
    await waitForApp(page)
    const { total, chips } = await headerStats(page)
    expect(chips.length).toBeGreaterThan(0)
    expect(chips.reduce((a, b) => a + b, 0)).toBe(total)
  })

  test('re-polls and refreshes the status timestamp', async ({ page }) => {
    await waitForApp(page)
    const before = await page.textContent('.status')
    await page.waitForFunction(
      (prev) => document.querySelector('.status')?.textContent !== prev,
      before,
      { timeout: 30_000 },
    )
    const after = await page.textContent('.status')
    expect(after).not.toBe(before)
  })
})
