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
      vehiclesOnScreen: m.queryRenderedFeatures({ layers: ['vehicles-icon'] }).length,
      shapesOnScreen: m.queryRenderedFeatures({ layers: ['shapes-line'] }).length,
      sampleVehicle: m.queryRenderedFeatures({ layers: ['vehicles-icon'] })[0]?.properties ?? null,
      vehicleLayerFilter: m.getLayer('vehicles-icon')?.filter ?? null,
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
