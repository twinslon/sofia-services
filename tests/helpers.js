/** Shared helpers for driving the app + MapLibre instance. */

export const KNOWN_MODES = new Set(['metro', 'tram', 'trolley', 'bus', 'other'])

/** Load the app and wait for: live feed ok + map fully rendered.
 * `animate` opts into vehicle tweening (slower; default snaps vehicles). */
export async function waitForApp(page, { animate = false } = {}) {
  await page.goto(animate ? '/' : '/?static-vehicles')
  await page.waitForSelector('.status.status-ok', { timeout: 60_000 })
  await page.waitForFunction(() => window.__map?.loaded?.() === true, undefined, { timeout: 60_000 })
}

/** Pixel-agnostic render stats straight from the MapLibre instance. */
export function mapStats(page) {
  return page.evaluate(() => {
    const m = window.__map
    const canvas = document.querySelector('canvas.maplibregl-canvas')
    return {
      canvasW: canvas?.clientWidth ?? 0,
      canvasH: canvas?.clientHeight ?? 0,
      tilesLoaded: m.areTilesLoaded(),
      vehiclesOnScreen: m.queryRenderedFeatures({ layers: ['vehicles-core'] }).length,
      shapesOnScreen: m.queryRenderedFeatures({ layers: ['shapes-line'] }).length,
      sampleVehicle: m.queryRenderedFeatures({ layers: ['vehicles-core'] })[0]?.properties ?? null,
      vehicleLayerFilter: m.getLayer('vehicles-core')?.filter ?? null,
    }
  })
}

/** Header status + chip counts, read atomically (same JS turn). */
export function headerStats(page) {
  return page.evaluate(() => {
    const total = Number(document.querySelector('.status')?.textContent?.match(/(\d+) vehicles/)?.[1] ?? 0)
    const chips = [...document.querySelectorAll('.chip .count')].map((el) => Number(el.textContent))
    return { total, chips }
  })
}

/** Click a rendered line at a spot not covered by stops/vehicles (priority
 * clicks). Retries a few times — animated vehicles can move into a spot. */
export async function clickALine(page, attempts = 3) {
  const tryClick = () =>
    page.evaluate(() => {
      const m = window.__map
      for (const f of m.queryRenderedFeatures({ layers: ['shapes-line'] }).slice(0, 120)) {
        const coords = f.geometry.coordinates
        for (let i = 1; i < coords.length; i += 2) {
          const [lng, lat] = coords[i]
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
          const point = m.project(coords[i])
          if (m.queryRenderedFeatures(point, { layers: ['stops-dot', 'vehicles-core'] }).length > 0) continue
          if (m.queryRenderedFeatures(point, { layers: ['shapes-line'] }).length === 0) continue
          m.fire('click', { lngLat: coords[i], point })
          return f.properties.routeId
        }
      }
      return null
    })

  for (let attempt = 0; attempt < attempts; attempt++) {
    const routeId = await tryClick()
    if (routeId && (await page.locator('.line-panel').isVisible())) return routeId
    await page.waitForTimeout(700)
  }
  return null
}

/** Fail the test if any console/page errors occur during the callback. */
export async function expectNoErrors(page, fn) {
  const errors = []
  const onConsole = (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`)
  const onPage = (e) => errors.push(`page: ${e}`)
  page.on('console', onConsole)
  page.on('pageerror', onPage)
  try {
    await fn()
  } finally {
    page.off('console', onConsole)
    page.off('pageerror', onPage)
  }
  const real = errors.filter((e) => !/WebGL|swiftshader|gpu|Automatic fallback/i.test(e))
  if (real.length > 0) throw new Error(`Browser errors:\n${real.join('\n')}`)
}
