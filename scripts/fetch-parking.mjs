/**
 * fetch-parking.mjs — parking & charging data for Sofia from OpenStreetMap
 * (© OpenStreetMap contributors, ODbL) via the Overpass API.
 *
 * Bakes: bicycle parking, car parks and EV charging stations into
 * public/data/parking.json. Refreshed daily by CI; the committed file
 * doubles as a fallback when Overpass is unreachable.
 *
 * Usage: node scripts/fetch-parking.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises'

const OUT_DIR = new URL('../public/data/', import.meta.url)
const BBOX = '(42.4, 22.8, 43.1, 23.9)'
const HOSTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass-api.de/api/interpreter',
]
const QUERY = `[out:json][timeout:180];
(
  node["amenity"="bicycle_parking"]${BBOX};
  way["amenity"="bicycle_parking"]${BBOX};
  node["amenity"="parking"]${BBOX};
  way["amenity"="parking"]${BBOX};
  node["amenity"="charging_station"]${BBOX};
);
out center tags;`

const AMENITY_TO_TYPE = { bicycle_parking: 'bike', parking: 'car', charging_station: 'ev' }

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

async function main() {
  const elements = await fetchElements()
  const features = []

  for (const el of elements) {
    const type = AMENITY_TO_TYPE[el.tags?.amenity]
    if (!type) continue
    const lat = el.lat ?? el.center?.lat
    const lon = el.lon ?? el.center?.lon
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    if (!inBbox(lat, lon)) continue

    const tags = el.tags ?? {}
    const feature = {
      id: `${el.type}/${el.id}`,
      type,
      lat: Math.round(lat * 1e5) / 1e5,
      lon: Math.round(lon * 1e5) / 1e5,
    }
    if (tags.name) feature.name = tags.name
    if (tags.capacity) feature.capacity = tags.capacity
    if (tags['capacity:disabled']) feature.capacityDisabled = tags['capacity:disabled']
    if (tags.access && tags.access !== 'yes') feature.access = tags.access
    if (tags.fee && tags.fee !== 'no') feature.fee = tags.fee === 'yes' ? 'paid' : tags.fee
    if (tags.operator) feature.operator = tags.operator
    if (tags.parking) feature.kind = tags.parking // surface / multi-storey / underground ...
    if (tags.bicycle_parking) feature.kind = tags.bicycle_parking // stands / lockers / shed ...
    // EV: count socket tags
    const sockets = Object.keys(tags).filter((k) => k.startsWith('socket:')).length
    if (type === 'ev' && sockets > 0) feature.sockets = sockets
    if (tags['charge'] && type === 'ev') feature.charge = tags['charge']

    features.push(feature)
  }

  const counts = { bike: 0, car: 0, ev: 0 }
  for (const f of features) counts[f.type]++

  if (features.length < 50) {
    // A near-empty bake means the mirror answered with thin/filtered data —
    // keep the previous file instead of wiping the layer
    throw new Error(
      `implausibly small result (${features.length} features) — keeping previous parking.json`,
    )
  }

  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(
    new URL('parking.json', OUT_DIR),
    JSON.stringify({
      generated_at: new Date().toISOString(),
      source: 'OpenStreetMap via Overpass API (ODbL)',
      counts,
      features,
    }),
  )
  console.log(
    `parking.json: ${features.length} features — bike ${counts.bike}, car ${counts.car}, ev ${counts.ev}`,
  )
}

async function fetchElements() {
  const errors = []
  for (const [i, host] of HOSTS.entries()) {
    if (i > 0) {
      console.log(`  waiting 20s before next host ...`)
      await new Promise((r) => setTimeout(r, 20_000))
    }
    try {
      console.log(`trying ${host} ...`)
      const res = await fetch(host, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: QUERY }),
        signal: AbortSignal.timeout(180_000),
      })
      if (res.status === 429) throw new Error('HTTP 429 rate-limited')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('json')) throw new Error(`unexpected content-type ${ct}`)
      const json = await res.json()
      if (!Array.isArray(json.elements)) throw new Error('no elements')
      console.log(`  ok: ${json.elements.length} elements`)
      return json.elements
    } catch (e) {
      errors.push(`${host}: ${String(e).slice(0, 120)}`)
      console.warn(`  failed: ${e.message}`)
    }
  }
  throw new Error(`all Overpass hosts failed: ${errors.join(' | ')}`)
}

function inBbox(lat, lon) {
  return lat > 42.4 && lat < 43.1 && lon > 22.8 && lon < 23.9
}
