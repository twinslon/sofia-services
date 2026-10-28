import { test, expect } from '@playwright/test'
import { waitForApp } from './helpers.js'

test.describe('air quality mode', () => {
  test('switching to Air hides transport layers and shows stations', async ({ page }) => {
    await waitForApp(page)

    await page.getByRole('tab', { name: 'Air' }).click()

    // Transport layers hidden, air layers visible
    const state = await page.evaluate(() => {
      const m = window.__map
      return {
        vehiclesHidden: m.getLayoutProperty('vehicles-core', 'visibility') === 'none',
        stopsHidden: m.getLayoutProperty('stops-dot', 'visibility') === 'none',
        aqVisible: m.getLayoutProperty('aq-dot', 'visibility') === 'visible',
        stations: m.queryRenderedFeatures({ layers: ['aq-dot'] }).length,
      }
    })
    expect(state.vehiclesHidden).toBe(true)
    expect(state.stopsHidden).toBe(true)
    expect(state.aqVisible).toBe(true)
    // 6 official stations baked in the snapshot
    expect(state.stations).toBeGreaterThanOrEqual(4)

    // Pollutant chips replaced the mode chips
    await expect(page.locator('.chip', { hasText: 'NO₂' })).toBeVisible()

    // Status reflects air mode
    await expect(page.locator('.status')).toContainText(/Air quality|Loading air/)

    // Switch back — transport layers return and vehicles render
    await page.getByRole('tab', { name: 'Transport' }).click()
    const back = await page.evaluate(() => {
      const m = window.__map
      return {
        vehiclesVisible: m.getLayoutProperty('vehicles-core', 'visibility') === 'visible',
        aqHidden: m.getLayoutProperty('aq-dot', 'visibility') === 'none',
        vehicles: m.queryRenderedFeatures({ layers: ['vehicles-core'] }).length,
      }
    })
    expect(back.vehiclesVisible).toBe(true)
    expect(back.aqHidden).toBe(true)
    if (back.vehicles === 0) test.info().annotations.push({ type: 'note', description: 'no vehicles in feed right now' })
  })

  test('community sensors render for PM pollutants and hide otherwise', async ({ page }) => {
    await waitForApp(page)
    await page.getByRole('tab', { name: 'Air' }).click()
    await page.waitForTimeout(800)

    // PM10 selected by default: hundreds of citizen dots
    const pm10 = await page.evaluate(() => {
      const m = window.__map
      return m.queryRenderedFeatures({ layers: ['community-dot'] }).length
    })
    expect(pm10).toBeGreaterThan(50)

    // Switch to NO2 — community sensors have no NO2 data, layer empties
    await page.locator('.chip', { hasText: 'NO₂' }).click()
    const no2 = await page.evaluate(() => {
      const m = window.__map
      return m.queryRenderedFeatures({ layers: ['community-dot'] }).length
    })
    expect(no2).toBe(0)
  })

  test('station click opens popup with pollutant values and band colors', async ({ page }) => {
    await waitForApp(page)
    await page.getByRole('tab', { name: 'Air' }).click()

    const clicked = await page.evaluate(() => {
      const m = window.__map
      const f = m.queryRenderedFeatures({ layers: ['aq-dot'] })[0]
      if (!f) return null
      m.fire('click', { lngLat: f.geometry.coordinates, point: m.project(f.geometry.coordinates) })
      return { name: f.properties.name }
    })
    test.skip(!clicked, 'no aq stations rendered')

    const popup = page.locator('.aq-popup')
    await expect(popup).toBeVisible()
    await expect(popup.locator('h2')).toContainText(clicked.name)
    const rows = popup.locator('.aq-list li')
    const rowCount = await rows.count()
    expect(rowCount).toBeGreaterThan(0)
    // Each row: colored band dot + pollutant label + numeric value
    await expect(rows.first().locator('.aq-band-dot')).toBeVisible()
    await expect(rows.first().locator('.aq-val')).toHaveText(/\d/)
  })
})
