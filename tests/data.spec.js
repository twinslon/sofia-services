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

  test('stops: deduplicated, in-use, with merged member ids', () => {
    const stops = data('stops')
    const ids = Object.keys(stops)
    expect(ids.length).toBeGreaterThan(1500)
    expect(ids.length).toBeLessThan(3500)

    const toRad = (d) => (d * Math.PI) / 180
    const distM = (a, b) => {
      const dLat = toRad(b.y - a.y)
      const dLon = toRad(b.x - a.x)
      const m =
        Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.y)) * Math.cos(toRad(b.y)) * Math.sin(dLon / 2) ** 2
      return 2 * 6371000 * Math.asin(Math.sqrt(m))
    }

    const entries = Object.values(stops)
    let checked = 0
    for (const s of entries) {
      if (!s.n) throw new Error('stop has no name')
      if (!s.ids?.length || !s.ids.includes(Object.keys(stops).find((k) => stops[k] === s))) {
        throw new Error('stop missing its own id in ids[]')
      }
      if (!(s.x > 22.8 && s.x < 23.8 && s.y > 42.4 && s.y < 43.05)) {
        throw new Error(`stop out of bounds: ${s.x},${s.y}`)
      }
      if (++checked > 500) break
    }

    // Invariant: no two same-name stops within the merge radius
    const byName = new Map()
    for (const s of entries) {
      const key = s.n.trim()
      if (!byName.has(key)) byName.set(key, [])
      byName.get(key).push(s)
    }
    for (const ss of byName.values()) {
      for (let i = 0; i < ss.length; i++) {
        for (let j = i + 1; j < ss.length; j++) {
          if (distM(ss[i], ss[j]) < 60) {
            throw new Error(`same-name stops within 60m survived dedup: ${ss[i].n}`)
          }
        }
      }
    }
  })

  test('lines: per-route headsign groups with resolvable ordered stops', () => {
    const lines = data('lines')
    const stops = data('stops')
    const routes = data('routes')
    const routeIds = Object.keys(lines)
    expect(routeIds.length).toBeGreaterThan(120)
    for (const routeId of routeIds.slice(0, 60)) {
      expect(routes[routeId], `route ${routeId} exists`).toBeTruthy()
      const groups = Object.entries(lines[routeId])
      expect(groups.length).toBeGreaterThan(0)
      expect(groups.length).toBeLessThanOrEqual(3)
      for (const [headsign, g] of groups) {
        expect(g.stops.length).toBeGreaterThan(3)
        for (const stopId of g.stops) {
          if (!stops[stopId]) throw new Error(`route ${routeId} "${headsign}" references unknown stop ${stopId}`)
        }
      }
    }
  })

  test('stop aliases: every original id maps to an existing stop', () => {
    const aliases = data('stop-aliases')
    const stops = data('stops')
    const entries = Object.entries(aliases)
    expect(entries.length).toBeGreaterThan(1000)
    for (const [orig, rep] of entries.slice(0, 800)) {
      if (!stops[rep]) throw new Error(`alias ${orig} -> unknown stop ${rep}`)
      if (orig === rep) throw new Error(`self-alias ${orig}`)
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
