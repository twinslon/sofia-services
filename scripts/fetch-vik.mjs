/**
 * fetch-vik.mjs — current water interruptions for Sofia from ViK's ArcGIS
 * InfoCenter (gispx.sofiyskavoda.bg, WSI_PUBLIC/InfoCenter_Public).
 *
 * Requires Referer of the embedded map app origin (without it the WAF 403s).
 * Layers 2/3/4 carry interruption statuses; names are read dynamically.
 *
 * Usage: node scripts/fetch-vik.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises'
import proj4 from 'proj4'

// ViK's ArcGIS layers store geometry in the Bulgarian CK-1970-style TM
// projection (CM 27°E, x_0 500 km, Krasovsky) — convert to WGS84
proj4.defs('VIK_CS1970', '+proj=tmerc +lat_0=0 +lon_0=27 +k=1 +x_0=500000 +y_0=0 +ellps=krass +units=m +no_defs')
const toWGS84 = (p) => proj4('VIK_CS1970', 'EPSG:4326', p)

const HOST = 'https://gispx.sofiyskavoda.bg/arcgis/rest/services/WSI_PUBLIC/InfoCenter_Public/MapServer'
const REFERER = 'https://gispx.sofiyskavoda.bg/WebApp.InfoCenter/?a=0&tab=0'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/156.0 Safari/537.36'
const OUT_DIR = new URL('../public/data/', import.meta.url)
const LAYER_IDS = [2, 3, 4]
const MAX_FEATURES = 500

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

async function main() {
  const root = await get(`${HOST}?f=json`)
  const layerNames = new Map((root.layers ?? []).map((l) => [l.id, l.name]))
  console.log('layers:', [...layerNames.entries()].map(([id, name]) => `${id}:${name}`).join(' | '))

  const layers = []
  for (const id of LAYER_IDS) {
    const qs = new URLSearchParams({
      where: '1=1',
      outFields: '*',
      returnGeometry: 'true',
      f: 'json',
      resultRecordCount: String(MAX_FEATURES),
    })
    const j = await get(`${HOST}/${id}/query?${qs}`)
    const name = layerNames.get(id) ?? `layer ${id}`
    const feats = (j.features ?? []).map((f) => {
      const g = f.geometry ?? {}
      let geometry = null
      if (Array.isArray(g.rings)) geometry = { type: 'Polygon', coordinates: g.rings.map((ring) => ring.map(toWGS84)) }
      else if (Number.isFinite(g.x) && Number.isFinite(g.y)) geometry = { type: 'Point', coordinates: toWGS84([g.x, g.y]) }
      return { ...f, geometry: geometry ?? f.geometry }
    })
    layers.push({ id, name, count: feats.length, exceeded: !!j.exceededTransferLimit, features: feats })
    console.log(`  layer ${id} (${name}): ${feats.length} features`)
  }

  const out = {
    generated_at: new Date().toISOString(),
    source: 'ViK Sofia ArcGIS InfoCenter_Public (WSI_PUBLIC)',
    layers,
  }
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(new URL('outages-vik.json', OUT_DIR), JSON.stringify(out))
  console.log(`outages-vik.json written`)
}

async function get(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: REFERER, Accept: '*/*' },
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`GET ${url.slice(0, 90)}: HTTP ${res.status}`)
  return res.json()
}
