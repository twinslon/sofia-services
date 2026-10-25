/**
 * Transport data helpers: GTFS-RT decoding, static lookups, GeoJSON building.
 *
 * Real-time feed: Center for Urban Mobility (Sofia Traffic), CC-BY-4.0
 * https://gtfs.sofiatraffic.bg/api/v1/vehicle-positions
 */

import GtfsRealtimeBindings from 'gtfs-realtime-bindings'

const { transit_realtime } = GtfsRealtimeBindings

export const RT_URLS = {
  vehiclePositions: 'https://gtfs.sofiatraffic.bg/api/v1/vehicle-positions',
  tripUpdates: 'https://gtfs.sofiatraffic.bg/api/v1/trip-updates',
  alerts: 'https://gtfs.sofiatraffic.bg/api/v1/alerts',
}

/** GTFS route_type -> our mode key */
export const ROUTE_TYPE_TO_MODE = {
  0: 'tram',
  1: 'metro',
  2: 'rail',
  3: 'bus',
  4: 'ferry',
  11: 'trolley',
  12: 'monorail',
}

export const MODES = {
  metro: { label: 'Metro', color: '#e63946' },
  tram: { label: 'Tram', color: '#f4a261' },
  trolley: { label: 'Trolley', color: '#2a9d8f' },
  bus: { label: 'Bus', color: '#4361ee' },
  other: { label: 'Other', color: '#8d99ae' },
}

export const SOFIA_CENTER = [23.3219, 42.6977]

/** Fetch + decode a GTFS-RT feed into a plain entity list. */
export async function fetchRealtimeFeed(url) {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Feed request failed: HTTP ${res.status}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  const feed = transit_realtime.FeedMessage.decode(buf)
  return feed.entity ?? []
}

/** Index trip-updates entities by stop and by trip. */
export function buildArrivalsIndex(entities) {
  const byStop = new Map() // stopId -> [{ tripId, routeId, time }]
  const byTrip = new Map() // tripId -> [{ stopId, time }] (chronological)
  for (const e of entities) {
    const tu = e.tripUpdate
    if (!tu?.trip?.tripId) continue
    const { tripId, routeId } = tu.trip
    const tripStops = []
    for (const s of tu.stopTimeUpdate ?? []) {
      const time = Number(s.arrival?.time ?? s.departure?.time ?? 0)
      if (!s.stopId || !time) continue
      tripStops.push({ stopId: s.stopId, time })
      const arr = byStop.get(s.stopId)
      if (arr) arr.push({ tripId, routeId, time })
      else byStop.set(s.stopId, [{ tripId, routeId, time }])
    }
    if (tripStops.length) {
      tripStops.sort((a, b) => a.time - b.time)
      byTrip.set(tripId, tripStops)
    }
  }
  return { byStop, byTrip }
}

/** Upcoming arrivals at a stop (aggregates merged stop ids), enriched with static GTFS. */
export function arrivalsForStop(stop, index, { routes, trips }, nowSec = Date.now() / 1000) {
  const ids = stop?.ids?.length ? stop.ids : [stop?.id]
  const list = ids.flatMap((id) => index?.byStop?.get(id) ?? [])
  return list
    .map(({ tripId, routeId, time }) => {
      const route = routes[trips[tripId]?.r ?? routeId]
      const etaSec = Math.round(time - nowSec)
      return {
        line: route?.n || routeId || '?',
        mode: route ? (ROUTE_TYPE_TO_MODE[route.t] ?? 'other') : 'other',
        color: route?.c ? `#${route.c}` : null,
        headsign: trips[tripId]?.h ?? '',
        etaSec,
        time,
      }
    })
    .filter((a) => a.etaSec > -30)
    .sort((a, b) => a.time - b.time)
    .slice(0, 12)
}

/** "now", "2 min", "1:32" — absolute time when far out. */
export function formatEta(etaSec) {
  if (etaSec < 45) return 'now'
  if (etaSec < 3600) return `${Math.round(etaSec / 60)} min`
  const d = new Date(Date.now() + etaSec * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Extract a normalized vehicle list from decoded vehicle-position entities. */
export function extractVehicles(entities) {
  const vehicles = []
  for (const e of entities) {
    const v = e.vehicle
    if (!v?.trip || !v?.position) continue
    vehicles.push({
      id: v.vehicle?.id ?? e.id,
      tripId: v.trip.tripId ?? null,
      routeId: v.trip.routeId ?? null,
      lat: v.position.latitude,
      lon: v.position.longitude,
      bearing: v.position.bearing ?? null,
    })
  }
  return vehicles
}

/** Build the vehicle GeoJSON FeatureCollection, enriched with static GTFS. */
export function buildVehicleFeatures(vehicles, { routes, trips }) {
  const features = vehicles.map((v) => {
    const trip = v.tripId ? trips[v.tripId] : null
    const routeId = trip?.r ?? v.routeId
    const route = routeId ? routes[routeId] : null
    const mode = route ? (ROUTE_TYPE_TO_MODE[route.t] ?? 'other') : 'other'
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
      properties: {
        id: v.id,
        tripId: v.tripId,
        mode,
        line: route?.n || routeId || '?',
        headsign: trip?.h || '',
        bearing: v.bearing,
      },
    }
  })
  return { type: 'FeatureCollection', features }
}

/** Build the route-shape GeoJSON FeatureCollection from static GTFS. */
export function buildShapeFeatures({ routes, trips, shapes }) {
  // shape_id -> { modes:Set, color, line } (a shape may be shared; take first)
  const shapeMeta = new Map()
  for (const trip of Object.values(trips)) {
    if (!trip.s || shapeMeta.has(trip.s)) continue
    const route = routes[trip.r]
    if (!route) continue
    shapeMeta.set(trip.s, {
      mode: ROUTE_TYPE_TO_MODE[route.t] ?? 'other',
      color: route.c ? `#${route.c}` : null,
    })
  }
  const features = []
  for (const [shapeId, coords] of Object.entries(shapes)) {
    const meta = shapeMeta.get(shapeId)
    if (!meta || coords.length < 2) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: { shapeId, mode: meta.mode, color: meta.color },
    })
  }
  return { type: 'FeatureCollection', features }
}
