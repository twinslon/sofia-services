/**
 * Air quality helpers: pollutant metadata, EEA index bands, station FC.
 * Data: EEA Air Quality Download Service (official stations), see scripts/fetch-aq.mjs
 */

export const POLLUTANTS = {
  PM10: { key: 'PM10', label: 'PM10', unit: 'µg/m³' },
  PM2_5: { key: 'PM2.5', label: 'PM2.5', unit: 'µg/m³' },
  NO2: { key: 'NO2', label: 'NO₂', unit: 'µg/m³' },
  O3: { key: 'O3', label: 'O₃', unit: 'µg/m³' },
  SO2: { key: 'SO2', label: 'SO₂', unit: 'µg/m³' },
  CO: { key: 'CO', label: 'CO', unit: 'mg/m³' },
}

/** Feed keys -> UI keys ('PM2.5' has a dot; keep map keys clean) */
export const FEED_KEY_TO_UI = { PM10: 'PM10', 'PM2.5': 'PM2_5', NO2: 'NO2', O3: 'O3', SO2: 'SO2', CO: 'CO' }
export const UI_KEY_TO_FEED = Object.fromEntries(Object.entries(FEED_KEY_TO_UI).map(([f, u]) => [u, f]))

/** EEA European Air Quality Index breakpoints per pollutant (see BREAKPOINTS below) */

const BREAKPOINTS = {
  //              good  fair  mod  poor  vpoor
  PM10: [20, 40, 50, 100, 150],
  'PM2.5': [10, 20, 25, 50, 75],
  NO2: [40, 90, 120, 230, 340],
  O3: [50, 100, 130, 240, 380],
  SO2: [100, 200, 350, 500, 750],
  CO: [4.4, 8.8, 11.6, 19.4, 28.8],
}

const LEVELS = [
  { level: 'good', label: 'Good', bg: 'Добро', color: '#50f0e6' },
  { level: 'fair', label: 'Fair', bg: 'Приемливо', color: '#50ccaa' },
  { level: 'moderate', label: 'Moderate', bg: 'Умерено', color: '#f0e641' },
  { level: 'poor', label: 'Poor', bg: 'Лошо', color: '#ff5050' },
  { level: 'very-poor', label: 'Very poor', bg: 'Много лошо', color: '#960032' },
  { level: 'extremely-poor', label: 'Extremely poor', bg: 'Изключително лошо', color: '#7d2181' },
]

/** Band label in the given language. */
export function aqiBandLabel(band, lang = 'en') {
  if (!band) return '—'
  return lang === 'bg' ? (band.bg ?? band.label) : band.label
}

/** Inline SVG trend line for [[unixSec, value], ...] history points. */
export function sparklineSVG(points, color, w = 96, h = 22) {
  if (!Array.isArray(points) || points.length < 2) return ''
  const clean = points.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
  if (clean.length < 2) return ''
  const xs = clean.map((p) => p[0])
  const vs = clean.map((p) => p[1])
  const minX = Math.min(...xs)
  const spanX = Math.max(...xs) - minX || 1
  const minV = Math.min(...vs)
  const spanV = Math.max(...vs) - minV || 1
  const pt = ([t, v]) => `${(((t - minX) / spanX) * (w - 6) + 3).toFixed(1)},${(h - 3 - ((v - minV) / spanV) * (h - 6)).toFixed(1)}`
  const lastPt = pt(clean[clean.length - 1]).split(',')
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">` +
    `<polyline fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points="${clean.map(pt).join(' ')}"/>` +
    `<circle cx="${lastPt[0]}" cy="${lastPt[1]}" r="2.2" fill="${color}"/></svg>`
}

/** Band lookup for a pollutant feed key ('PM10', 'PM2.5', ...) and value. */
export function aqiBand(feedKey, value) {
  const bp = BREAKPOINTS[feedKey]
  if (!bp || !Number.isFinite(value)) return null
  let i = 0
  while (i < bp.length && value > bp[i]) i++
  return LEVELS[i] ?? null
}

/** All bands ordered good -> extremely poor (for legends). */
export function aqiBandScale() {
  return [...LEVELS]
}

/** Stations GeoJSON for the map, colored by the selected pollutant. */
export function buildAqFeatures(aqData, selectedUiKey) {
  const feedKey = UI_KEY_TO_FEED[selectedUiKey] ?? 'PM10'
  const features = (aqData?.stations ?? []).map((s) => {
    const reading = s.values?.[feedKey]
    const band = reading ? aqiBand(feedKey, reading.v) : null
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: {
        code: s.code,
        name: s.name,
        area: s.area,
        values: JSON.stringify(s.values ?? {}),
        level: band?.level ?? 'none',
        color: band?.color ?? '#8c959f',
        value: reading?.v ?? null,
      },
    }
  })
  return { type: 'FeatureCollection', features }
}

// Sensor.Community citizen sensors report only PM (P1 = PM10, P2 = PM2.5)
const PM_FEED_KEYS = new Set(['PM10', 'PM2.5'])
const COMMUNITY_MAX_PLAUSIBLE = 1000 // µg/m³ — above this a sensor is malfunctioning

/** "2026-10-28 18:52:28" (UTC) -> Date. The API omits T/Z. */
export function parseScTimestamp(ts) {
  return new Date(String(ts).replace(' ', 'T') + 'Z')
}

/**
 * Sofia citizen-sensor GeoJSON colored by the selected pollutant.
 * Returns null when the pollutant has no community coverage (NO2/O3/...).
 * Invalid or implausible readings (>1000 µg/m³) are skipped.
 */
export function buildCommunityFeatures(scData, selectedUiKey) {
  const feedKey = POLLUTANTS[selectedUiKey]?.key ?? UI_KEY_TO_FEED[selectedUiKey] ?? 'PM10'
  if (!PM_FEED_KEYS.has(feedKey)) return null
  const pmKey = feedKey === 'PM10' ? 'P1' : 'P2'
  const features = (scData?.sensors ?? [])
    .map((s) => {
      const v = s[pmKey]
      if (v == null || !Number.isFinite(v) || v > COMMUNITY_MAX_PLAUSIBLE || v < 0) return null
      const band = aqiBand(feedKey, v)
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        properties: {
          sid: s.id,
          type: s.type,
          color: band?.color ?? '#8c959f',
          level: band?.level ?? 'none',
          value: v,
          tsMs: parseScTimestamp(s.timestamp)?.getTime() ?? null,
        },
      }
    })
    .filter(Boolean)
  return { type: 'FeatureCollection', features }
}
