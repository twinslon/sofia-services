/**
 * fetch-aq.mjs — official air-quality data for Sofia
 *
 * Stations: EEA AQViewer measurement metadata (names, coords, types)
 * Values:   EEA Air Quality Download Service (Parquet API, dataset 1 = UTD)
 *           https://eeadmz1-downloads-api-appservice.azurewebsites.net
 *
 * Produces public/data/aq.json — latest valid hourly value per Sofia
 * station per pollutant. Station list is cached in aq-stations.json and
 * only rebuilt when missing.
 *
 * Usage: node scripts/fetch-aq.mjs
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { parquetReadObjects } from 'hyparquet'

const OUT_DIR = new URL('../public/data/', import.meta.url)
const STATIONS_URL =
  'https://discomap.eea.europa.eu/App/AQViewer/download?fqn=Airquality_Dissem.b2g.measurements&f=csv'
const PARQUET_API = 'https://eeadmz1-downloads-api-appservice.azurewebsites.net/ParquetFile/urls'

// EEA pollutant numeric codes -> our notation keys
const POLLUTANT_CODES = { 1: 'SO2', 5: 'PM10', 7: 'O3', 8: 'NO2', 10: 'CO', 6001: 'PM2.5' }
const POLLUTANTS = Object.values(POLLUTANT_CODES)

// Sofia bounds (loose)
const IN_BBOX = (lon, lat) => lon > 22.8 && lon < 23.9 && lat > 42.4 && lat < 43.1

const KEEP_HOURS = 48

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

async function main() {
  // ── stations (cached) ──────────────────────────────────────────────
  let stations
  const stationsFile = new URL('aq-stations.json', OUT_DIR)
  if (existsSync(stationsFile)) {
    stations = JSON.parse(await readFile(stationsFile, 'utf8'))
    console.log(`stations: ${stations.length} (cached)`)
  } else {
    console.log('downloading station metadata ...')
    const res = await fetch(STATIONS_URL)
    if (!res.ok) throw new Error(`metadata: HTTP ${res.status}`)
    // The endpoint serves a zip despite the text/html content-type
    const { unzipSync } = await import('fflate')
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
    const csvName = Object.keys(files).find((n) => n.toLowerCase().endsWith('.csv'))
    if (!csvName) throw new Error(`metadata zip has no csv: ${Object.keys(files).join(', ')}`)
    const csv = new TextDecoder().decode(files[csvName])

    const byCode = new Map()
    for (const row of parseCsv(csv)) {
      if (row.Country !== 'Bulgaria' || row['Air Quality Station Name'] === undefined) continue
      const lon = Number(row.Longitude)
      const lat = Number(row.Latitude)
      const pollutant = row['Air Pollutant']
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || !IN_BBOX(lon, lat)) continue
      if (!POLLUTANTS.includes(pollutant)) continue
      if (row['Operational Activity End']) continue // closed
      const code = row['Air Quality Station EoI Code']
      let st = byCode.get(code)
      if (!st) {
        st = {
          code,
          name: row['Air Quality Station Name'].replace(/"/g, '').replace(/\s+-\s*Sofia$/, '').replace(/^AMS\s+/i, ''),
          lat,
          lon,
          area: row['Air Quality Station Area'] || '',
          type: row['Air Quality Station Type'] || '',
          pollutants: [],
        }
        byCode.set(code, st)
      }
      if (!st.pollutants.includes(pollutant)) st.pollutants.push(pollutant)
    }
    stations = [...byCode.values()]
    await mkdir(OUT_DIR, { recursive: true })
    await writeFile(stationsFile, JSON.stringify(stations, null, 1))
    console.log(`stations: ${stations.length} (extracted)`)
  }

  // ── latest values ──────────────────────────────────────────────────
  console.log('requesting parquet urls ...')
  const res = await fetch(PARQUET_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      countries: ['BG'],
      cities: ['Sofia'],
      pollutants: POLLUTANTS,
      dataset: 1,
      dateTimeStart: new Date(Date.now() - KEEP_HOURS * 3600e3).toISOString(),
      dateTimeEnd: new Date().toISOString(),
      aggregationType: 'hour',
    }),
  })
  if (!res.ok) throw new Error(`parquet api: HTTP ${res.status} ${await res.text()}`)
  const urls = (await res.text())
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('http'))
  console.log(`parquet files: ${urls.length}`)

  const byStation = new Map() // code -> { pollutant: {v, t, h: [[unixSec, value]]} }
  const since = Date.now() - KEEP_HOURS * 3600e3
  let measures = 0
  for (const url of urls) {
    const file = await toArrayBuffer(fetchBlob(url))
    let rows
    try {
      rows = await parquetReadObjects({ file })
    } catch (e) {
      console.warn(`  skip unparseable file: ${url.split('/').pop()} (${e.message})`)
      continue
    }
    // rows are chronological; keep the last valid value + 48h history per pollutant
    for (const r of rows) {
      if (r.Validity !== 1 || r.Value == null) continue
      const endMs = Date.parse(r.End)
      if (!Number.isFinite(endMs) || endMs < since) continue
      const code = stationCodeOf(r.Samplingpoint)
      const pollutant = POLLUTANT_CODES[r.Pollutant]
      if (!code || !pollutant) continue
      const station = byStation.get(code) ?? byStation.set(code, {}).get(code)
      const cur = station[pollutant] ?? (station[pollutant] = { v: 0, t: '', h: [] })
      const v = Math.round(r.Value * 100) / 100
      cur.h.push([Math.round(endMs / 1000), v])
      cur.v = v
      cur.t = r.End
      measures++
    }
  }
  for (const st of byStation.values()) {
    for (const p of Object.values(st)) {
      p.h.sort((a, b) => a[0] - b[0])
      p.h = p.h.slice(-KEEP_HOURS) // cap at 48 hourly points
    }
  }
  console.log(`history points: ${measures}`)

  const out = {
    generated_at: new Date().toISOString(),
    source: 'EEA Air Quality Download Service (UTD/E2a)',
    stations: stations
      .map((s) => ({ ...s, values: byStation.get(s.code) ?? {} }))
      .filter((s) => Object.keys(s.values).length > 0),
  }
  await writeFile(new URL('aq.json', OUT_DIR), JSON.stringify(out))
  console.log(
    `aq.json: ${out.stations.length} stations with fresh values ` +
      `(${out.stations.map((s) => s.code).join(', ')})`,
  )
}

function stationCodeOf(samplingPoint) {
  // "BG/SPO-BG0052A_00005_100" -> "BG0052A"
  const m = /SPO-(BG\d+[A-Za-z])_/.exec(String(samplingPoint))
  return m?.[1] ?? null
}

async function fetchBlob(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`blob ${url.split('/').pop()}: HTTP ${res.status}`)
  return res.arrayBuffer()
}

async function toArrayBuffer(promise) {
  const ab = await promise
  return { byteLength: ab.byteLength, slice: async (a, b) => ab.slice(a, b) }
}

/** Minimal quoted CSV parser (header row keys). */
function parseCsv(text) {
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
        } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else if (c !== '\r') field += c
  }
  const [header, ...rest] = rows
  const idx = Object.fromEntries(header.map((h, i) => [h, i]))
  return rest.map((r) => {
    const o = {}
    for (const [h, i] of Object.entries(idx)) o[h] = r[i] ?? ''
    return o
  })
}
