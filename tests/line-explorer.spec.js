import { test, expect } from '@playwright/test'
import { waitForApp } from './helpers.js'

test.describe('line explorer', () => {
  test('clicking a line opens the explorer with ordered stops', async ({ page }) => {
    await waitForApp(page)

    // Click a rendered line shape at a spot not covered by stops/vehicles
    // (the app's click handler prioritizes vehicles > stops > lines)
    const selected = await page.evaluate(() => {
      const m = window.__map
      const shapes = m.queryRenderedFeatures({ layers: ['shapes-line'] })
      for (const f of shapes.slice(0, 40)) {
        const coords = f.geometry.coordinates
        for (let i = 1; i < coords.length; i += 3) {
          const lngLat = coords[i]
          if (!Number.isFinite(lngLat[0]) || !Number.isFinite(lngLat[1])) continue
          const point = m.project(lngLat)
          const blockers = m.queryRenderedFeatures(point, { layers: ['stops-dot', 'vehicles-core'] })
          const lines = m.queryRenderedFeatures(point, { layers: ['shapes-line'] })
          if (blockers.length === 0 && lines.length > 0) {
            m.fire('click', { lngLat, point })
            return { routeId: f.properties.routeId, mode: f.properties.mode }
          }
        }
      }
      return null
    })
    test.skip(!selected, 'no line shapes rendered')

    const panel = page.locator('.line-panel')
    await expect(panel).toBeVisible()

    // The selected line is highlighted on the map
    const filter = await page.evaluate(() => JSON.stringify(window.__map.getLayer('shapes-selected')?.filter))
    expect(filter).toContain(selected.routeId)

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
    const cleared = await page.evaluate(() => JSON.stringify(window.__map.getLayer('shapes-selected')?.filter))
    expect(cleared).not.toContain(selected.routeId)
  })
})
