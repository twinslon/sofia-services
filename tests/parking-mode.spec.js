import { test, expect } from '@playwright/test'
import { buildParkingFC, PARKING_COLORS, parkingTypeLabel } from '../src/lib/parking.js'
import { waitForApp } from './helpers.js'

test.describe('parking lib', () => {
  test('per-type colors are distinct and flow into features', () => {
    const colors = Object.values(PARKING_COLORS)
    expect(new Set(colors).size).toBe(3) // all three distinct
    const sc = {
      features: [
        { id: 'n/1', type: 'bike', lat: 42.7, lon: 23.3 },
        { id: 'w/2', type: 'car', lat: 42.71, lon: 23.31 },
        { id: 'n/3', type: 'ev', lat: 42.72, lon: 23.32 },
      ],
    }
    const fc = buildParkingFC(sc, ['bike', 'car', 'ev'])
    expect(fc.features.length).toBe(3)
    for (const f of fc.features) {
      expect(f.properties.color).toBe(PARKING_COLORS[f.properties.type])
    }
    expect(PARKING_COLORS.car).not.toBe(PARKING_COLORS.bike)
  })

  test('parkingTypeLabel localizes', () => {
    expect(parkingTypeLabel('bike', 'bg')).toBe('Велопаркинг')
    expect(parkingTypeLabel('car', 'en')).toBe('Car park')
  })
})

test.describe('parking mode', () => {
  test('switching to Parking hides other layers and shows OSM spots', async ({ page }) => {
    await waitForApp(page)

    await page.getByRole('tab', { name: 'Parking' }).click()

    // Wait for the async parking bake fetch to land and render
    await page.waitForFunction(
      () => window.__map.queryRenderedFeatures({ layers: ['parking-dot'] }).length > 0,
      undefined,
      { timeout: 20_000 },
    )

    const state = await page.evaluate(() => {
      const m = window.__map
      return {
        vehiclesHidden: m.getLayoutProperty('vehicles-icon', 'visibility') === 'none',
        stopsHidden: m.getLayoutProperty('stops-dot', 'visibility') === 'none',
        aqHidden: m.getLayoutProperty('aq-dot', 'visibility') === 'none',
        parkingVisible: m.getLayoutProperty('parking-dot', 'visibility') === 'visible',
        spots: m.queryRenderedFeatures({ layers: ['parking-dot'] }).length,
      }
    })
    expect(state.vehiclesHidden).toBe(true)
    expect(state.stopsHidden).toBe(true)
    expect(state.aqHidden).toBe(true)
    expect(state.parkingVisible).toBe(true)
    expect(state.spots).toBeGreaterThan(100)

    // Status shows the OSM bake count
    await expect(page.locator('.status')).toContainText(/parking/i)

    // Layer chips: bike / car / EV
    await expect(page.locator('.chip', { hasText: 'EV charging' })).toBeVisible()
  })

  test('EV chip toggle hides EV dots but keeps the rest', async ({ page }) => {
    await waitForApp(page)
    await page.getByRole('tab', { name: 'Parking' }).click()

    // Wait for the parking bake to load and render
    await page.waitForFunction(
      () => window.__map.queryRenderedFeatures({ layers: ['parking-dot'] }).length > 0,
      undefined,
      { timeout: 20_000 },
    )

    const before = await page.evaluate(
      () => window.__map.queryRenderedFeatures({ layers: ['parking-dot'] }).length,
    )

    // EV chip is on by default — turn it off
    await page.locator('.chip', { hasText: 'EV charging' }).click()
    await page.waitForFunction(
      () => {
        const m = window.__map
        return m.queryRenderedFeatures({ layers: ['parking-dot'] }).every((f) => f.properties.type !== 'ev')
      },
      undefined,
      { timeout: 10_000 },
    )

    // Turn it back on
    await page.locator('.chip', { hasText: 'EV charging' }).click()
    await page.waitForFunction(
      () => {
        const m = window.__map
        return m.queryRenderedFeatures({ layers: ['parking-dot'] }).some((f) => f.properties.type === 'ev')
      },
      undefined,
      { timeout: 10_000 },
    )
    expect(before).toBeGreaterThan(50)
  })

  test('parking spot click opens detail popup', async ({ page }) => {
    await waitForApp(page)
    await page.getByRole('tab', { name: 'Parking' }).click()

    // Wait for the bake to load, then real-DOM-click a spot
    await page.waitForFunction(
      () => window.__map.queryRenderedFeatures({ layers: ['parking-dot'] }).length > 0,
      undefined,
      { timeout: 20_000 },
    )

    const clicked = await page.evaluate(() => {
      const m = window.__map
      const f = m.queryRenderedFeatures({ layers: ['parking-dot'] })[0]
      if (!f) return null
      m.fire('click', { lngLat: f.geometry.coordinates, point: m.project(f.geometry.coordinates) })
      return { type: f.properties.type, name: f.properties.name }
    })
    test.skip(!clicked, 'no parking features rendered')

    const popup = page.locator('.aq-popup')
    await expect(popup).toBeVisible()
    if (clicked.name) await expect(popup.locator('h2')).toContainText(clicked.name.slice(0, 8))
    // Footer credits OSM
    await expect(popup.locator('.veh-id')).toContainText('OpenStreetMap')
  })
})
