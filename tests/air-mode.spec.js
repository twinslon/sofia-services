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
    await page.waitForFunction(
      () => window.__map.queryRenderedFeatures({ layers: ['community-dot'] }).length === 0,
      undefined,
      { timeout: 10_000 },
    )
  })

  test('service visibility replays when the map finishes loading late', async ({ page }) => {
    // Delay the basemap style so the map loads well AFTER we switch to Air —
    // regression test: UI state set pre-load was silently dropped
    await page.route('**/styles/positron**', async (route) => {
      await new Promise((r) => setTimeout(r, 3000))
      return route.continue()
    })
    await page.goto('/?static-vehicles')

    // Switch to Air immediately — before the map has even started loading
    await page.getByRole('tab', { name: 'Air' }).click()
    await page.waitForSelector('.status.status-ok', { timeout: 60_000 })
    await page.waitForFunction(() => window.__map?.loaded?.() === true, undefined, { timeout: 60_000 })
    await page.waitForFunction(
      () => window.__map.queryRenderedFeatures({ layers: ['aq-dot'] }).length > 0,
      undefined,
      { timeout: 30_000 },
    )

    const state = await page.evaluate(() => ({
      aqVisible: window.__map.getLayoutProperty('aq-dot', 'visibility') === 'visible',
      transportHidden: window.__map.getLayoutProperty('vehicles-core', 'visibility') === 'none',
    }))
    expect(state.aqVisible).toBe(true)
    expect(state.transportHidden).toBe(true)
  })

  test('citizen popup uses the selected pollutant (PM2.5, not hardcoded PM10)', async ({ page }) => {
    await waitForApp(page)
    await page.getByRole('tab', { name: 'Air' }).click()
    await page.locator('.chip', { hasText: 'PM2.5' }).click()
    await page.waitForTimeout(500)

    const clicked = await page.evaluate(() => {
      const m = window.__map
      const f = m.queryRenderedFeatures({ layers: ['community-dot'] })[0]
      if (!f) return null
      const p = m.project(f.geometry.coordinates)
      const rect = m.getCanvas().getBoundingClientRect()
      const cx = rect.left + p.x, cy = rect.top + p.y
      const canvas = m.getCanvas()
      for (const type of ['mousedown', 'mouseup', 'click']) {
        canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy }))
      }
      return { pollutant: f.properties.pollutant, value: f.properties.value }
    })
    test.skip(!clicked, 'no citizen sensors rendered')

    const popup = page.locator('.aq-popup')
    await expect(popup).toBeVisible()
    await expect(popup.locator('.aq-poll').first()).toHaveText('PM2.5')
  })

  test('clicking a station under the legend still opens the popup (legend is click-through)', async ({ page }) => {
    await waitForApp(page)
    await page.getByRole('tab', { name: 'Air' }).click()
    await page.waitForTimeout(900)

    // zoom into the center so stations sit near the legend corner, then
    // REAL-DOM-click the first station (user's symptom: popup never opened)
    await page.evaluate(() => window.__map.jumpTo({ center: [23.3194, 42.6934], zoom: 14.5 }))
    await page.waitForTimeout(1200)

    const clicked = await page.evaluate(() => {
      const m = window.__map
      const legend = document.querySelector('.aq-legend')?.getBoundingClientRect()
      const canvas = m.getCanvas()
      for (const f of m.queryRenderedFeatures({ layers: ['aq-dot'] })) {
        const p = m.project(f.geometry.coordinates)
        // real DOM click sequence — same path a user's mouse takes
        for (const type of ['mousedown', 'mouseup', 'click']) {
          canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y }))
        }
        return {
          name: f.properties.name,
          underLegend:
            legend &&
            legend.left <= p.x && p.x <= legend.right &&
            legend.top <= p.y && p.y <= legend.bottom,
        }
      }
      return null
    })
    test.skip(!clicked, 'no stations rendered')

    const popup = page.locator('.aq-popup')
    await expect(popup).toBeVisible({ timeout: 10_000 })
    await expect(popup.locator('h2')).toContainText(clicked.name.slice(0, 10))
    // legend must not intercept clicks anywhere
    const pe = await page.evaluate(() => getComputedStyle(document.querySelector('.aq-legend')).pointerEvents)
    expect(pe).toBe('none')
  })

  test('citizen sensor click opens its popup (real DOM coordinates)', async ({ page }) => {
    await waitForApp(page)
    await page.getByRole('tab', { name: 'Air' }).click()
    await page.waitForTimeout(1200)

    const clicked = await page.evaluate(() => {
      const m = window.__map
      const f = m.queryRenderedFeatures({ layers: ['community-dot'] })[0]
      if (!f) return null
      const p = m.project(f.geometry.coordinates)
      const rect = m.getCanvas().getBoundingClientRect()
      const cx = rect.left + p.x
      const cy = rect.top + p.y
      const canvas = m.getCanvas()
      for (const type of ['mousedown', 'mouseup', 'click']) {
        canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy }))
      }
      return { sid: f.properties.sid, value: f.properties.value }
    })
    test.skip(!clicked, 'no citizen sensors rendered')

    const popup = page.locator('.aq-popup')
    await expect(popup).toBeVisible()
    await expect(popup.locator('h2')).toContainText(new RegExp(`#${clicked.sid}|№${clicked.sid}`))
    await expect(popup.locator('.aq-list li').first()).toContainText('PM10')
  })

  test('station click opens popup with pollutant values, bands and sparklines', async ({ page }) => {
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
    // Sparkline trend per pollutant (official stations bake 48h history)
    const sparks = await popup.locator('svg.spark').count()
    if (sparks === 0) {
      test.info().annotations.push({ type: 'note', description: 'no history rows baked — check fetch-aq' })
    }
    await expect(popup.locator('svg.spark').first()).toBeAttached()
  })
})
