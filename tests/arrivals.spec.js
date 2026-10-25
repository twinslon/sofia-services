import { test, expect } from '@playwright/test'
import { waitForApp } from './helpers.js'

test.describe('arrivals board popup', () => {
  test('search a stop and show its board popup on the map', async ({ page }) => {
    await waitForApp(page)

    // Type a central stop name and pick the first suggestion
    await page.fill('.stop-search input', 'СЕРДИКА')
    await page.waitForSelector('.stop-results button')
    await page.click('.stop-search .stop-results button >> nth=0')

    // Board popup opens on the map with the stop name
    const popup = page.locator('.maplibregl-popup .board-popup')
    await expect(popup).toBeVisible()
    await expect(popup.locator('.board-title h2')).toContainText(/СЕРДИКА/i)

    // Either live arrivals or an explicit empty state (night-safe)
    const rows = popup.locator('.board-row')
    const empty = popup.locator('.board-empty')
    await expect(rows.or(empty).first()).toBeVisible({ timeout: 20_000 })

    const rowCount = await rows.count()
    if (rowCount > 0) {
      await expect(popup.locator('.board-row .line-badge').first()).toBeVisible()
      await expect(popup.locator('.board-row .board-eta').first()).toHaveText(/\d+ min|now|\d{2}:\d{2}/)
    }

    // The stop is highlighted on the map (stops-selected layer filter)
    const stopId = await page.evaluate(() => window.__map.getLayer('stops-selected')?.filter?.[2])
    expect(stopId).toBeTruthy()

    // Closing the popup clears the selection and the highlight
    await page.locator('.maplibregl-popup-close-button').click()
    await expect(page.locator('.maplibregl-popup')).toHaveCount(0)
    const cleared = await page.evaluate(() => window.__map.getLayer('stops-selected')?.filter?.[2])
    expect(cleared).toBe('')
  })

  test('search by stop code works', async ({ page }) => {
    await waitForApp(page)
    // 1338 = bus stop near NDK used in API docs; zero-padded form not required
    await page.fill('.stop-search input', '1338')
    await page.waitForSelector('.stop-results button')
    await page.click('.stop-search .stop-results button >> nth=0')
    await expect(page.locator('.maplibregl-popup .board-popup')).toBeVisible()
  })
})
