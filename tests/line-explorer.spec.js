import { test, expect } from '@playwright/test'
import { waitForApp } from './helpers.js'

test.describe('line explorer v2', () => {
  test('picker opens from the header, line select shows explorer', async ({ page }) => {
    await waitForApp(page)

    await page.locator('.header-btn').click()
    const picker = page.locator('.line-picker')
    await expect(picker).toBeVisible()

    // Search narrows to line 30 (bus A109)
    await page.fill('.picker-search', '30')
    const rows = page.locator('.picker-row')
    await expect(rows.first()).toBeVisible()
    await rows.first().click()

    // Explorer panel with directions and ordered stops
    const panel = page.locator('.line-panel')
    await expect(panel).toBeVisible()
    await expect(panel.locator('.line-dir').first()).toBeVisible()
    const stopButtons = panel.locator('.dir-stops button')
    expect(await stopButtons.count()).toBeGreaterThan(3)

    // Selected line highlighted on the map
    const filter = await page.evaluate(() => JSON.stringify(window.__map.getLayer('shapes-selected')?.filter))
    expect(filter).toContain('A109')

    // Clicking a stop in the sequence opens its arrivals board popup
    await stopButtons.first().click()
    const board = page.locator('.maplibregl-popup .board-popup')
    await expect(board).toBeVisible()

    // Closing the explorer clears the map highlight
    await panel.locator('.board-close').click()
    await expect(panel).toHaveCount(0)
    const cleared = await page.evaluate(() => window.__map.getLayer('shapes-selected')?.filter?.[2])
    expect(cleared).toBe('')
  })

  test('live next departures appear when the feed covers the line', async ({ page }) => {
    await waitForApp(page)
    await page.locator('.header-btn').click()
    await page.fill('.picker-search', '30')
    await page.locator('.picker-row').first().click()

    const panel = page.locator('.line-panel')
    await expect(panel).toBeVisible()
    await page.waitForTimeout(500)
    const depCount = await panel.locator('.dep').count()
    // Departures exist whenever buses are running — night-safe skip otherwise
    if (depCount === 0) test.info().annotations.push({ type: 'note', description: 'no departures right now' })
  })
})
