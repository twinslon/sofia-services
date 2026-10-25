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

  test('line explorer opens as a bottom sheet', async ({ page }) => {
    await waitForApp(page)

    const selected = await page.evaluate(() => {
      const m = window.__map
      for (const f of m.queryRenderedFeatures({ layers: ['shapes-line'] }).slice(0, 40)) {
        const coords = f.geometry.coordinates
        for (let i = 1; i < coords.length; i += 3) {
          const [lng, lat] = coords[i]
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
          const point = m.project(coords[i])
          if (m.queryRenderedFeatures(point, { layers: ['stops-dot', 'vehicles-core'] }).length === 0) {
            m.fire('click', { lngLat: coords[i], point })
            return true
          }
        }
      }
      return false
    })
    test.skip(!selected, 'no clear line spot found')

    const sheet = page.locator('.line-panel')
    await expect(sheet).toBeVisible()
    const box = await sheet.boundingBox()

    // Anchored to the bottom, spanning (nearly) full width
    expect(box.width).toBeGreaterThan(370)
    expect(box.y + box.height).toBeGreaterThan(830)
    expect(box.y).toBeGreaterThan(844 * 0.35) // leaves map visible above

    // Stop rows are touch-sized
    const stopRow = sheet.locator('.dir-stops button').first()
    const rowBox = await stopRow.boundingBox()
    expect(rowBox.height).toBeGreaterThan(38)
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
