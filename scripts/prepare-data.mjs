/**
 * prepare-data.mjs
 *
 * Downloads the official Sofia Traffic static GTFS feed and extracts slim
 * JSON files into public/data/ for the web app.
 *
 * Source: Center for Urban Mobility (Centar za gradska mobilnost)
 * https://gtfs.sofiatraffic.bg/api/v1/static
 * License: CC-BY-4.0 (https://www.sofia.bg/web/guest/transport-data)
 *
 * Usage: npm run prepare-data
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'

const GTFS_STATIC_URL = 'https://gtfs.sofiatraffic.bg/api/v1/static'
const OUT_DIR = new URL('../public/data/', import.meta.url)

// ~3m tolerance in degrees for Douglas-Peucker simplification of shapes
const SIMPLIFY_TOLERANCE = 0.00003
const FIXED = 5 // decimal places for coordinates (~1.1 m)
// Same-name stops closer than this merge into one board (directional pairs etc.)
// Test invariant checks 60m, so keep a buffer above it for coordinate rounding
const STOP_MERGE_RADIUS_M = 75

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

async function main() {
  console.log(`Downloading ${GTFS_STATIC_URL} ...`)
  const res = await fetch(GTFS_STATIC_URL)
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
  const zipBuf = new Uint8Array(await res.arrayBuffer())
  console.log(`Downloaded ${(zipBuf.length / 1e6).toFixed(1)} MB, unzipping ...`)

  const files = unzipSync(zipBuf)
  const read = (name) => new TextDecoder().decode(files[name])

  console.log('Parsing routes.txt ...')
  const routes = parseGtfsCsv(read('routes.txt'))
  console.log('Parsing trips.txt ...')
  const trips = parseGtfsCsv(read('trips.txt'))
  console.log('Parsing stops.txt ...')
  const stops = parseGtfsCsv(read('stops.txt'))
  console.log('Parsing stop_times.txt (stop usage + line sequences) ...')
  const usedStopIds = new Set()
  const tripStopIds = new Map() // trip_id -> [stop_id] in order
  {
    const text = read('stop_times.txt')
    const lines = text.split('\n')
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      if (!line) continue
      const tripId = line.slice(0, line.indexOf(','))
      const stopId = nthCsvField(line, 3)
      if (!tripId || !stopId) continue
      usedStopIds.add(stopId)
      const arr = tripStopIds.get(tripId)
      if (arr) arr.push(stopId)
      else tripStopIds.set(tripId, [stopId])
    }
  }
  console.log('Parsing shapes.txt ...')
  const shapeRows = parseGtfsCsv(read('shapes.txt'))

  // --- routes.json: route_id -> metadata -------------------------------
  const routesOut = {}
  for (const r of routes) {
    routesOut[r.route_id] = {
      n: r.route_short_name || '',
      ln: r.route_long_name || '',
      t: Number(r.route_type),
      c: (r.route_color || '').toLowerCase() || null,
    }
  }

  // --- shapes.json: shape_id -> [[lon, lat], ...] (simplified) ----------
  const byShape = new Map()
  for (const s of shapeRows) {
    const lon = Number(s.shape_pt_lon)
    const lat = Number(s.shape_pt_lat)
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    const id = s.shape_id
    let pts = byShape.get(id)
    if (!pts) byShape.set(id, (pts = []))
    pts.push([round(lon), round(lat)])
  }
  const shapesOut = {}
  let raw = 0
  let kept = 0
  for (const [id, pts] of byShape) {
    raw += pts.length
    const simplified = simplifyDouglasPeucker(pts, SIMPLIFY_TOLERANCE)
    kept += simplified.length
    shapesOut[id] = simplified
  }

  // --- trips.json: trip_id -> { route_id, shape_id, headsign } ----------
  const tripsOut = {}
  for (const t of trips) {
    tripsOut[t.trip_id] = {
      r: t.route_id,
      s: t.shape_id || null,
      h: t.trip_headsign || '',
      d: t.direction_id === '' ? null : Number(t.direction_id),
    }
  }

  // --- stops.json: deduplicated, in-use stops ---------------------------
  // 1) keep only named stops referenced by at least one trip (dead stops
  //    never get arrivals and clutter the map)
  // 2) merge same-name clusters within STOP_MERGE_RADIUS_M into one entry
  //    with an `ids` list — the board aggregates arrivals across members
  const liveStops = stops.filter(
    (s) => s.stop_name && s.location_type !== '1' && usedStopIds.has(s.stop_id),
  )

  const byName = new Map()
  const normName = (n) => n.trim().replace(/\s+/g, ' ')
  for (const s of liveStops) {
    const key = normName(s.stop_name)
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push(s)
  }

  const parent = new Map() // union-find
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)))), parent.get(x))
  const union = (a, b) => {
    const [ra, rb] = [find(a), find(b)]
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const s of liveStops) parent.set(s.stop_id, s.stop_id)

  let mergedPairs = 0
  for (const group of byName.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (distM(group[i], group[j]) < STOP_MERGE_RADIUS_M) {
          union(group[i].stop_id, group[j].stop_id)
          mergedPairs++
        }
      }
    }
  }

  const clusters = new Map() // root -> [stops]
  for (const s of liveStops) {
    const root = find(s.stop_id)
    if (!clusters.has(root)) clusters.set(root, [])
    clusters.get(root).push(s)
  }

  const stopsOut = {}
  for (const members of clusters.values()) {
    // deterministic representative: lowest numeric code
    members.sort((a, b) => (Number(a.stop_code) || 1e9) - (Number(b.stop_code) || 1e9))
    const rep = members[0]
    stopsOut[rep.stop_id] = {
      c: rep.stop_code || '',
      cs: [...new Set(members.map((m) => m.stop_code).filter(Boolean))],
      n: rep.stop_name,
      y: round(Number(rep.stop_lat)),
      x: round(Number(rep.stop_lon)),
      ids: members.map((m) => m.stop_id),
    }
  }

  // --- lines.json: per route/headsign stop sequences ---------------------
  // This feed has no direction_id — headsigns (destinations) act as
  // directions. Representative trip per headsign = the one visiting the
  // most stops; stop ids resolve to deduplicated (merged) stop ids.
  const stopIdToRep = new Map() // original stop_id -> representative stop_id
  for (const members of clusters.values()) {
    const repId = members[0].stop_id
    for (const m of members) stopIdToRep.set(m.stop_id, repId)
  }

  const linesOut = {}
  const headsignStats = new Map() // routeId|headsign -> { count, trips: [{stops, tripId}] }
  for (const [tripId, t] of Object.entries(tripsOut)) {
    const stopsCount = tripStopIds.get(tripId)?.length ?? 0
    if (!stopsCount || !t.r) continue
    const key = `${t.r}|${t.h || ''}`
    let stat = headsignStats.get(key)
    if (!stat) headsignStats.set(key, (stat = { count: 0, best: { stops: 0, tripId: null } }))
    stat.count++
    if (stopsCount > stat.best.stops) stat.best = { stops: stopsCount, tripId }
  }
  const byRoute = new Map() // routeId -> [{headsign, count, best}]
  for (const [key, stat] of headsignStats) {
    const pipe = key.indexOf('|')
    const routeId = key.slice(0, pipe)
    const headsign = key.slice(pipe + 1)
    if (!byRoute.has(routeId)) byRoute.set(routeId, [])
    byRoute.get(routeId).push({ headsign, count: stat.count, best: stat.best })
  }
  for (const [routeId, groups] of byRoute) {
    linesOut[routeId] = {}
    // Keep the most-served headsigns (usually outbound + inbound)
    groups.sort((a, b) => b.count - a.count)
    for (const g of groups.slice(0, 3)) {
      const raw = tripStopIds.get(g.best.tripId) ?? []
      const seq = []
      let prev = null
      for (const sid of raw) {
        const rep = stopIdToRep.get(sid) ?? sid
        if (rep !== prev) {
          seq.push(rep)
          prev = rep
        }
      }
      linesOut[routeId][g.headsign || '—'] = {
        trips: g.count,
        n: seq.length,
        stops: seq,
      }
    }
  }

  // stop aliases: original stop_id -> representative stop_id (for lookups
  // against RT feed stop ids, which reference original ids)
  const stopAliases = {}
  for (const members of clusters.values()) {
    const repId = members[0].stop_id
    for (const m of members) if (m.stop_id !== repId) stopAliases[m.stop_id] = repId
  }

  await mkdir(OUT_DIR, { recursive: true })
  await Promise.all([
    writeFile(new URL('routes.json', OUT_DIR), JSON.stringify(routesOut)),
    writeFile(new URL('shapes.json', OUT_DIR), JSON.stringify(shapesOut)),
    writeFile(new URL('trips.json', OUT_DIR), JSON.stringify(tripsOut)),
    writeFile(new URL('stops.json', OUT_DIR), JSON.stringify(stopsOut)),
    writeFile(new URL('stop-aliases.json', OUT_DIR), JSON.stringify(stopAliases)),
    writeFile(new URL('lines.json', OUT_DIR), JSON.stringify(linesOut)),
    writeFile(
      new URL('meta.json', OUT_DIR),
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          source: GTFS_STATIC_URL,
          license: 'CC-BY-4.0, Center for Urban Mobility (Sofia Traffic)',
          counts: {
            routes: Object.keys(routesOut).length,
            trips: Object.keys(tripsOut).length,
            shapes: Object.keys(shapesOut).length,
            stops: Object.keys(stopsOut).length,
            lines: Object.keys(linesOut).length,
            shape_points_raw: raw,
            shape_points_kept: kept,
          },
        },
        null,
        2,
      ),
    ),
  ])

  const typeCounts = {}
  for (const r of routes) typeCounts[r.route_type] = (typeCounts[r.route_type] || 0) + 1

  console.log('Done.')
  console.log(`  routes : ${Object.keys(routesOut).length}  (by type: ${JSON.stringify(typeCounts)})`)
  console.log(`  trips  : ${Object.keys(tripsOut).length}`)
  console.log(`  shapes : ${Object.keys(shapesOut).length}`)
  console.log(`  stops  : ${Object.keys(stopsOut).length} (from ${liveStops.length} in use; ${mergedPairs} close pairs merged, ${stops.filter((s) => s.stop_name).length - liveStops.length} dead dropped)`)
  console.log(`  lines  : ${Object.keys(linesOut).length} route/direction sequences`)
  console.log(`  points : ${raw.toLocaleString()} -> ${kept.toLocaleString()} after simplification`)
}

// --- helpers -----------------------------------------------------------

function round(n) {
  return Number(n.toFixed(FIXED))
}

/** Haversine distance in meters between two GTFS stop rows. */
function distM(a, b) {
  const toRad = (d) => (d * Math.PI) / 180
  const latA = Number(a.stop_lat)
  const lonA = Number(a.stop_lon)
  const dLat = toRad(Number(b.stop_lat) - latA)
  const dLon = toRad(Number(b.stop_lon) - lonA)
  const m =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(latA)) * Math.cos(toRad(Number(b.stop_lat))) * Math.sin(dLon / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(m))
}

/** Fast n-th (0-based) CSV field of a plain (unquoted) line. */
function nthCsvField(line, n) {
  let start = 0
  for (let f = 0; f < n; f++) {
    const next = line.indexOf(',', start)
    if (next === -1) return null
    start = next + 1
  }
  const end = line.indexOf(',', start)
  return end === -1 ? line.slice(start).trim() : line.slice(start, end)
}

/** Minimal quoted-CSV parser (GTFS files are simple quoted CSVs). */
export function parseGtfsCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  const [header, ...rest] = rows
  return rest.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

/** Iterative Douglas-Peucker polyline simplification. Points are [lon, lat]. */
export function simplifyDouglasPeucker(points, tolerance) {
  if (points.length <= 2) return points
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()
    let maxDist = -1
    let index = -1
    const [x1, y1] = points[first]
    const [x2, y2] = points[last]
    const dx = x2 - x1
    const dy = y2 - y1
    const lenSq = dx * dx + dy * dy
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i]
      let distSq
      if (lenSq === 0) {
        distSq = (px - x1) ** 2 + (py - y1) ** 2
      } else {
        let t = ((px - x1) * dx + (py - y1) * dy) / lenSq
        t = Math.max(0, Math.min(1, t))
        const ex = x1 + t * dx - px
        const ey = y1 + t * dy - py
        distSq = ex * ex + ey * ey
      }
      if (distSq > maxDist) {
        maxDist = distSq
        index = i
      }
    }
    if (maxDist > tolerance * tolerance) {
      keep[index] = 1
      stack.push([first, index], [index, last])
    }
  }
  return points.filter((_, i) => keep[i])
}
