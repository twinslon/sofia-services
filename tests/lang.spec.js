import { test, expect } from '@playwright/test'
import { waitForApp } from './helpers.js'

test.describe('language toggle', () => {
  test('defaults to English in an en-US browser', async ({ page }) => {
    await waitForApp(page)
    await expect(page.getByRole('tab', { name: 'Transport' })).toBeVisible()
    await expect(page.locator('.status')).toContainText(/vehicles/)
  })

  test('toggles to Bulgarian and persists across reload', async ({ page }) => {
    await waitForApp(page)
    await page.locator('.lang-switch .lang-btn', { hasText: 'БГ' }).click()

    await expect(page.getByRole('tab', { name: 'Транспорт' })).toBeVisible()
    await expect(page.locator('.status')).toContainText(/превозни средства/)
    await expect(page.locator('.chip').first()).toHaveText(/Всички/)

    await page.reload()
    await page.waitForSelector('.status.status-ok', { timeout: 60000 })
    await expect(page.getByRole('tab', { name: 'Транспорт' })).toBeVisible()

    // Back to English
    await page.locator('.lang-switch .lang-btn', { hasText: 'EN' }).click()
    await expect(page.getByRole('tab', { name: 'Transport' })).toBeVisible()
  })
})
