import { test, expect } from '@playwright/test'
import { clickALine, waitForApp } from './helpers.js'

test.describe('line explorer', () => {
  test('clicking a line opens the explorer with ordered stops', async ({ page }) => {
    await waitForApp(page)

    const selected = await clickALine(page)
    test.skip(!selected, 'no line shapes rendered')

    const panel = page.locator('.line-panel')
    await expect(panel).toBeVisible()

    // Whichever overlapping line won the click, it must be highlighted
    const selectedRouteId = await page.evaluate(() => window.__map.getLayer('shapes-selected')?.filter?.[2])
    expect(selectedRouteId).toBeTruthy()

    // Header shows a line badge and at least one direction with stops
    await expect(panel.locator('.line-badge').first()).toBeVisible()
    await expect(panel.locator('.line-dir h3').first()).toBeVisible()
    const stopButtons = panel.locator('.dir-stops button')
    expect(await stopButtons.count()).toBeGreaterThan(3)

    // Clicking a stop in the sequence opens its arrivals board popup
    await stopButtons.first().click()
    const board = page.locator('.maplibregl-popup .board-popup')
    await expect(board).toBeVisible()

    // Close the explorer — highlight clears
    await page.locator('.line-panel .board-close').click()
    await expect(panel).toHaveCount(0)
    const cleared = await page.evaluate(() => window.__map.getLayer('shapes-selected')?.filter?.[2])
    expect(cleared).toBe('')
  })
})
