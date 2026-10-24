import { test, expect } from '@playwright/test'
import { KNOWN_MODES, expectNoErrors, mapStats, waitForApp } from './helpers.js'

test.describe('map rendering', () => {
  test('canvas is full-size with tiles and layers loaded', async ({ page }) => {
    await expectNoErrors(page, async () => {
      await waitForApp(page)
      const stats = await mapStats(page)

      expect(stats.canvasW).toBeGreaterThan(1000)
      expect(stats.canvasH).toBeGreaterThan(600)
      expect(stats.tilesLoaded).toBe(true)
    })
  })

  test('renders route shapes and vehicles with valid properties', async ({ page }) => {
    await waitForApp(page)
    const stats = await mapStats(page)

    expect(stats.shapesOnScreen).toBeGreaterThan(50)

    // Vehicle assertions are time-of-day dependent: skip when service is
    // off (e.g. a 3am run) rather than fail
    if (stats.vehiclesOnScreen === 0) {
      test.skip(true, 'no vehicles in the live feed right now (night service?)')
    }
    expect(stats.vehiclesOnScreen).toBeGreaterThan(0)
    expect(KNOWN_MODES.has(stats.sampleVehicle.mode)).toBe(true)
    expect(stats.sampleVehicle.line).toBeTruthy()
  })

  test('mode filter applies to map layers and chips', async ({ page }) => {
    await waitForApp(page)

    await page.getByRole('button', { name: /Buses/ }).click()
    await expect(page.locator('.chip-active')).toContainText('Buses')

    const filtered = await mapStats(page)
    expect(JSON.stringify(filtered.vehicleLayerFilter)).toContain('bus')

    await page.getByRole('button', { name: /^All/ }).click()
    const unfiltered = await mapStats(page)
    expect(unfiltered.vehicleLayerFilter).toBeNull()
  })
})
