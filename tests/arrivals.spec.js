import { test, expect } from '@playwright/test'
import { waitForApp } from './helpers.js'

test.describe('arrivals board', () => {
  test('search a stop and show its arrivals board', async ({ page }) => {
    await waitForApp(page)

    // Type a central stop name and pick the first suggestion
    await page.fill('.stop-search input', 'СЕРДИКА')
    await page.waitForSelector('.stop-results button')
    await page.click('.stop-search .stop-results button >> nth=0')

    // Board opens with the stop name
    await expect(page.locator('.arrivals-board')).toBeVisible()
    await expect(page.locator('.board-header h2')).toContainText(/СЕРДИКА/i)

    // Either live arrivals or an explicit empty state (night-safe)
    const rows = page.locator('.board-row')
    const empty = page.locator('.board-empty')
    await expect(rows.or(empty).first()).toBeVisible({ timeout: 20_000 })

    const rowCount = await rows.count()
    if (rowCount > 0) {
      // Each row: colored line badge, headsign, ETA text
      await expect(page.locator('.board-row .line-badge').first()).toBeVisible()
      await expect(page.locator('.board-row .board-eta').first()).toHaveText(/\d+ min|now|\d{2}:\d{2}/)
    }

    // The stop is highlighted on the map (stops-selected layer filter)
    const stopId = await page.evaluate(() => {
      const f = window.__map.getLayer('stops-selected')?.filter
      return f?.[2] ?? null
    })
    expect(stopId).toBeTruthy()

    // Close button dismisses the board and clears the highlight
    await page.click('.board-close')
    await expect(page.locator('.arrivals-board')).toHaveCount(0)
    const clearedFilter = await page.evaluate(() => window.__map.getLayer('stops-selected')?.filter?.[2])
    expect(clearedFilter).toBe('')
  })

  test('search by stop code works', async ({ page }) => {
    await waitForApp(page)
    // 1338 = bus stop near NDK used in API docs; zero-padded form not required
    await page.fill('.stop-search input', '1338')
    await page.waitForSelector('.stop-results button')
    await page.click('.stop-search .stop-results button >> nth=0')
    await expect(page.locator('.arrivals-board')).toBeVisible()
  })
})
