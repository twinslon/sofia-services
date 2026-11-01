/**
 * Outages mode helpers — current water/heating/electricity interruptions.
 * Sources: ViK ArcGIS (baked), toplo.bg (baked), ERM Zapad avplan (baked).
 */

/** ViK layer 2 (Текущи спирания) features → GeoJSON (polygons + points). */
export function buildVikWaterFC(vikData) {
  const layer = vikData?.layers?.find((l) => l.id === 2)
  const features = (layer?.features ?? [])
    .map((f) => {
      const a = f.attributes ?? {}
      const g = f.geometry ?? {}
      let geometry = null
      if (Array.isArray(g.rings)) geometry = { type: 'Polygon', coordinates: g.rings }
      else if (Number.isFinite(g.x) && Number.isFinite(g.y)) geometry = { type: 'Point', coordinates: [g.x, g.y] }
      if (!geometry) return null
      return {
        type: 'Feature',
        geometry,
        properties: {
          alertType: a.ALERTTYPE ?? '',
          description: a.DESCRIPTION ?? '',
          district: a.SOFIADISTRIC ?? '',
          start: a.START_ ?? null,
          end: a.ALERTEND ?? null,
        },
      }
    })
    .filter(Boolean)
  return { type: 'FeatureCollection', features }
}

export function fmtRange(startMs, endMs, lang = 'en') {
  if (!startMs) return ''
  const fmt = (ms) =>
    new Date(ms).toLocaleString(lang === 'bg' ? 'bg-BG' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  return `${fmt(startMs)} → ${endMs ? fmt(endMs) : '…'}`
}
