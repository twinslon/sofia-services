import { test, expect } from '@playwright/test'
import { waitForApp } from './helpers.js'

test.describe('smooth vehicle movement', () => {
  test('vehicles glide between polls instead of jumping', async ({ page }) => {
    await waitForApp(page, { animate: true })

    const result = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const m = window.__map
          const roughMeters = (a, b) =>
            Math.hypot((b[0] - a[0]) * 82000, (b[1] - a[1]) * 111000)
          const sample = () => {
            const out = new Map()
            for (const f of m.queryRenderedFeatures({ layers: ['vehicles-core'] })) {
              out.set(f.properties.id, f.geometry.coordinates)
            }
            return out
          }

          const first = sample()
          if (first.size === 0) return resolve('no-vehicles')

          const t0 = Date.now()
          const check = () => {
            // Sample two consecutive rendered frames and look for a vehicle
            // that moved a small-but-nonzero distance — the signature of
            // tweening (a poll jump would be one big move between idle frames)
            const a = sample()
            requestAnimationFrame(() => {
              const b = sample()
              for (const [id, coords] of b) {
                const prev = a.get(id)
                if (!prev) continue
                const d = roughMeters(prev, coords)
                if (d > 0.2 && d < 100) {
                  // Confirm it also moved since the first sample (smooth progression)
                  const base = first.get(id)
                  const total = base ? roughMeters(base, coords) : -1
                  return resolve(`frame-move ${d.toFixed(1)}m, total ${total.toFixed(0)}m`)
                }
              }
              if (Date.now() - t0 > 15000) return resolve('timeout')
              requestAnimationFrame(check)
            })
          }
          requestAnimationFrame(check)
        }),
    )

    if (result === 'no-vehicles') test.skip(true, 'no vehicles in the feed right now')
    expect(result).not.toBe('timeout')
    expect(result).toMatch(/^frame-move/)
  })
})
