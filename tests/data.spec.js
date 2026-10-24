import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'

// Pure data-integrity checks on the prepared GTFS extracts (no browser).
const data = (name) => JSON.parse(readFileSync(new URL(`../public/data/${name}.json`, import.meta.url)))

// Loose bounds around Sofia
const IN_SOFIA = ([lon, lat]) => lon > 22.8 && lon < 23.8 && lat > 42.4 && lat < 43.05

test.describe('prepared GTFS extracts', () => {
  test('routes: 200+ with valid mode types', () => {
    const routes = data('routes')
    const ids = Object.keys(routes)
    expect(ids.length).toBeGreaterThan(200)
    for (const r of Object.values(routes)) {
      expect([0, 1, 3, 11]).toContain(r.t)
      expect(r.n).toBeTruthy()
    }
  })

  test('trips: 20k+ referencing existing routes and shapes', () => {
    const { routes } = { routes: data('routes') }
    const trips = data('trips')
    const shapes = data('shapes')
    const entries = Object.entries(trips)
    expect(entries.length).toBeGreaterThan(20_000)

    let checked = 0
    for (const [tripId, t] of entries) {
      if (t.r && !routes[t.r]) throw new Error(`trip ${tripId} references unknown route ${t.r}`)
      if (t.s && !shapes[t.s]) throw new Error(`trip ${tripId} references unknown shape ${t.s}`)
      // Spot-check a sample for speed
      if (++checked > 2000) break
    }
  })

  test('shapes: 1000+ polylines inside Sofia bounds', () => {
    const shapes = data('shapes')
    const ids = Object.keys(shapes)
    expect(ids.length).toBeGreaterThan(1000)

    let points = 0
    for (const id of ids.slice(0, 200)) {
      const line = shapes[id]
      expect(line.length).toBeGreaterThan(1)
      for (const pt of line) {
        expect(IN_SOFIA(pt)).toBe(true)
        points++
      }
    }
    expect(points).toBeGreaterThan(1000)
  })

  test('stops: 4k+ with code, name and Sofia-bounds coordinates', () => {
    const stops = data('stops')
    const ids = Object.keys(stops)
    expect(ids.length).toBeGreaterThan(4000)
    let checked = 0
    for (const [id, s] of Object.entries(stops)) {
      if (!s.n) throw new Error(`stop ${id} has no name`)
      if (!(s.x > 22.8 && s.x < 23.8 && s.y > 42.4 && s.y < 43.05)) {
        throw new Error(`stop ${id} out of bounds: ${s.x},${s.y}`)
      }
      if (++checked > 500) break
    }
  })

  test('meta: counts match the extracts and timestamp parses', () => {
    const meta = data('meta')
    expect(meta.counts.routes).toBe(Object.keys(data('routes')).length)
    expect(meta.counts.trips).toBe(Object.keys(data('trips')).length)
    expect(meta.counts.stops).toBe(Object.keys(data('stops')).length)
    expect(meta.license).toContain('CC-BY-4.0')
    expect(new Date(meta.generated_at).toString()).not.toBe('Invalid Date')
  })
})
