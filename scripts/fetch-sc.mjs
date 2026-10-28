/**
 * fetch-sc.mjs — extract the Sofia subset of the Sensor.Community network
 * (open-source citizen sensors, https://sensor.community, CC-BY-SA 4.0)
 *
 * The worldwide current-values file is ~8.5MB — too heavy to poll from the
 * browser. This bakes a Sofia-only subset (~100KB) for the client.
 *
 * Usage: node scripts/fetch-sc.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises'

const DATA_URL = 'https://data.sensor.community/static/v2/data.json'
const OUT_DIR = new URL('../public/data/', import.meta.url)

// Sofia bounds
const IN_BBOX = (lat, lon) => lat > 42.4 && lat < 43.1 && lon > 22.8 && lon < 23.9

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

async function main() {
  console.log('downloading worldwide Sensor.Community data (~8MB) ...')
  const res = await fetch(DATA_URL)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const all = await res.json()

  const seen = new Set()
  const sensors = []
  for (const d of all) {
    const lat = Number(d.location?.latitude)
    const lon = Number(d.location?.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !IN_BBOX(lat, lon)) continue
    if (d.location?.indoor === true || d.location?.indoor === 'true') continue // indoor readings
    const sensorId = d.sensor?.id
    if (sensorId == null || seen.has(sensorId)) continue
    seen.add(sensorId)

    const values = {}
    for (const v of d.sensordatavalues ?? []) {
      const num = Number(v.value)
      if (Number.isFinite(num)) values[v.value_type] = num
    }
    // keep only outdoor PM sensors (SDS011/PMS5003 style: P1 = PM10, P2 = PM2.5)
    if (values.P1 === undefined && values.P2 === undefined) continue

    sensors.push({
      id: sensorId,
      type: d.sensor?.sensor_type?.name ?? '',
      lat: Math.round(lat * 1e5) / 1e5,
      lon: Math.round(lon * 1e5) / 1e5,
      timestamp: d.timestamp,
      P1: values.P1, // PM10
      P2: values.P2, // PM2.5
    })
  }

  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(
    new URL('sc-sofia.json', OUT_DIR),
    JSON.stringify({ generated_at: new Date().toISOString(), count: sensors.length, sensors }),
  )
  console.log(`sc-sofia.json: ${sensors.length} outdoor PM sensors`)
}
