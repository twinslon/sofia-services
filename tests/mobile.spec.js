import { test, expect } from '@playwright/test'
import { waitForApp } from './helpers.js'

// Phone-class viewport for the whole file
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

test.describe('mobile layout', () => {
  test('header is compact: search full-width, chips in one scrollable row', async ({ page }) => {
    await waitForApp(page)

    const search = page.locator('.stop-search')
    const searchBox = await search.boundingBox()
    // Full width of the viewport (minus header padding)
    expect(searchBox.width).toBeGreaterThan(340)
    // On its own row: below the brand
    const brandBox = await page.locator('.brand').boundingBox()
    expect(searchBox.y).toBeGreaterThan(brandBox.y + brandBox.height - 2)

    // Chips row does not wrap into multiple rows
    const chipsBox = await page.locator('.filters').boundingBox()
    const firstChip = await page.locator('.chip').first().boundingBox()
    expect(chipsBox.height).toBeLessThan(firstChip.height * 2)
  })

  test('alerts panel opens as a bottom sheet', async ({ page }) => {
    await waitForApp(page)

    const bell = page.locator('.bell')
    await expect(bell).toBeVisible({ timeout: 30_000 })
    await bell.click()

    const sheet = page.locator('.alerts-panel')
    await expect(sheet).toBeVisible()
    const box = await sheet.boundingBox()

    // Anchored to the bottom, spanning (nearly) full width
    expect(box.width).toBeGreaterThan(370)
    expect(box.y + box.height).toBeGreaterThan(830)
    expect(box.y).toBeGreaterThan(844 * 0.35) // leaves map visible above

    await page.locator('.alerts-panel .board-close').click()
    await expect(sheet).toHaveCount(0)
  })

  test('stop board popup fits within the phone viewport', async ({ page }) => {
    await waitForApp(page)

    await page.fill('.stop-search input', 'СЕРДИКА')
    await page.waitForSelector('.stop-results button')
    await page.click('.stop-search .stop-results button >> nth=0')

    const popup = page.locator('.maplibregl-popup')
    await expect(popup).toBeVisible()
    const box = await popup.boundingBox()
    expect(box.width).toBeLessThanOrEqual(390)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
  })
})
