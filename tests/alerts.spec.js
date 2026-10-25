import { test, expect } from '@playwright/test'
import { waitForApp } from './helpers.js'

test.describe('service alerts', () => {
  test('bell appears once the alerts feed loads; panel opens and lists alerts', async ({ page }) => {
    await waitForApp(page)

    const bell = page.locator('.bell')
    await expect(bell).toBeVisible({ timeout: 30_000 })

    const hasAlerts = (await bell.locator('.bell-count').count()) > 0
    await bell.click()

    const panel = page.locator('.alerts-panel')
    await expect(panel).toBeVisible()

    if (hasAlerts) {
      const items = page.locator('.alert-item')
      await expect(items.first()).toBeVisible()
      // Each alert has meaningful text and metadata
      await expect(items.first().locator('.alert-text')).toContainText(/\S/)
      await expect(items.first().locator('.alert-tag')).toBeVisible()
      // Line badges resolve to route numbers (digits/letters), not raw route ids
      const badgeText = await items.first().locator('.line-badge').allTextContents()
      if (badgeText.length > 0) {
        expect(badgeText[0]).toMatch(/^[\dA-ZА-Я]+$/)
      }
    } else {
      await expect(page.locator('.alerts-panel .board-empty')).toBeVisible()
    }

    await page.locator('.alerts-panel .board-close').click()
    await expect(panel).toHaveCount(0)
  })

  test('routes with alerts get the amber highlight layer on the map', async ({ page }) => {
    await waitForApp(page)
    await page.waitForSelector('.bell', { timeout: 30_000 })

    const hasRouteAlerts = await page.evaluate(() => {
      const features = window.__map.queryRenderedFeatures({ layers: ['shapes-alert'] })
      return features.length
    })
    test.skip(hasRouteAlerts === 0, 'no route-scoped alerts visible right now')

    expect(hasRouteAlerts).toBeGreaterThan(0)
    // The highlighted features are marked and amber
    const sample = await page.evaluate(() => {
      const f = window.__map.queryRenderedFeatures({ layers: ['shapes-alert'] })[0]
      return { alert: f.properties.alert, layer: f.layer.id }
    })
    expect(sample.alert).toBe(true)
    expect(sample.layer).toBe('shapes-alert')
  })
})
