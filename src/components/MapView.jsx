import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { MODES, SOFIA_CENTER, formatEta } from '../lib/transport.js'

// OpenFreeMap: free vector tiles, no API key, no watermark
// https://openfreemap.org — styles: dark, positron, liberty, bright
const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark'

const MODE_COLOR_STOPS = Object.entries(MODES).map(([mode, m]) => [mode, m.color])

function colorByMode(fallback) {
  return ['coalesce', ['get', 'color'], ['match', ['get', 'mode'], ...MODE_COLOR_STOPS.flat(), fallback]]
}

function emptyFC() {
  return { type: 'FeatureCollection', features: [] }
}

export default function MapView({
  shapesFC,
  vehiclesFC,
  modeFilter,
  stopsData,
  selectedStopId,
  onSelectStop,
  arrivalsIndex,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const readyRef = useRef(false)
  const dataRef = useRef({ shapes: null, vehicles: null })
  const propsRef = useRef({ stopsData, arrivalsIndex })
  const popupRef = useRef(null)
  propsRef.current = { stopsData, arrivalsIndex }

  const pushData = (which, fc) => {
    const map = mapRef.current
    if (!map || !readyRef.current || !fc) return
    map.getSource(which)?.setData(fc)
  }

  // Create the map once
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE_URL,
      center: SOFIA_CENTER,
      zoom: 11.1,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('load', () => {
      map.addSource('shapes', {
        type: 'geojson',
        data: dataRef.current.shapes ?? emptyFC(),
      })
      map.addSource('vehicles', {
        type: 'geojson',
        data: dataRef.current.vehicles ?? emptyFC(),
      })
      map.addSource('stops', { type: 'geojson', data: emptyFC() })

      map.addLayer({
        id: 'shapes-line',
        type: 'line',
        source: 'shapes',
        paint: {
          'line-color': colorByMode(MODES.other.color),
          'line-opacity': 0.35,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 14, 1.6],
        },
      })

      map.addLayer({
        id: 'stops-dot',
        type: 'circle',
        source: 'stops',
        minzoom: 13,
        paint: {
          'circle-radius': 3.5,
          'circle-color': '#8b949e',
          'circle-opacity': 0.8,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#0d1117',
        },
      })
      map.addLayer({
        id: 'stops-selected',
        type: 'circle',
        source: 'stops',
        paint: {
          'circle-radius': 7,
          'circle-color': '#58a6ff',
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#e6edf3',
        },
        filter: ['==', ['get', 'stop_id'], selectedStopId ?? ''],
      })

      map.addLayer({
        id: 'vehicles-halo',
        type: 'circle',
        source: 'vehicles',
        paint: {
          'circle-radius': 6,
          'circle-color': colorByMode(MODES.other.color),
          'circle-opacity': 0.25,
          'circle-blur': 0.6,
        },
      })
      map.addLayer({
        id: 'vehicles-core',
        type: 'circle',
        source: 'vehicles',
        paint: {
          'circle-radius': 3.5,
          'circle-color': '#ffffff',
          'circle-stroke-width': 1.6,
          'circle-stroke-color': colorByMode(MODES.other.color),
        },
      })
      map.addLayer({
        id: 'vehicles-label',
        type: 'symbol',
        source: 'vehicles',
        layout: {
          'text-field': ['get', 'line'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-offset': [0, -1.6],
          'text-allow-overlap': false,
          'text-anchor': 'bottom',
        },
        paint: {
          'text-color': '#e6edf3',
          'text-halo-color': '#0d1117',
          'text-halo-width': 1.4,
        },
      })

      // Interactions
      map.on('click', 'stops-dot', (e) => {
        const f = e.features?.[0]
        if (f?.properties?.stop_id) onSelectStopRef.current(f.properties.stop_id)
      })
      map.on('mouseenter', 'stops-dot', () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', 'stops-dot', () => (map.getCanvas().style.cursor = ''))

      map.on('click', 'vehicles-core', (e) => {
        const f = e.features?.[0]
        if (!f) return
        popupRef.current?.remove()
        popupRef.current = new maplibregl.Popup({ closeButton: false, offset: 8, maxWidth: '260px' })
          .setLngLat(e.lngLat)
          .setHTML(vehiclePopupHTML(f.properties, propsRef.current))
          .addTo(map)
      })
      map.on('mouseenter', 'vehicles-core', () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', 'vehicles-core', () => (map.getCanvas().style.cursor = ''))

      readyRef.current = true
      // Exposed for debugging/E2E tests (queryRenderedFeatures etc.)
      window.__map = map
      map.resize()
      // Flush anything that arrived before the map finished loading
      pushData('shapes', dataRef.current.shapes)
      pushData('vehicles', dataRef.current.vehicles)
    })

    return () => {
      readyRef.current = false
      popupRef.current?.remove()
      map.remove()
      mapRef.current = null
      window.__map = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Latest callback for stop selection (used by map click handlers)
  const onSelectStopRef = useRef(onSelectStop)
  onSelectStopRef.current = onSelectStop

  useEffect(() => {
    dataRef.current.shapes = shapesFC
    pushData('shapes', shapesFC)
  }, [shapesFC])

  useEffect(() => {
    dataRef.current.vehicles = vehiclesFC
    pushData('vehicles', vehiclesFC)
  }, [vehiclesFC])

  // Push stop markers + highlight the selected one
  useEffect(() => {
    if (!stopsData) return
    const features = Object.entries(stopsData).map(([stopId, s]) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.x, s.y] },
      properties: { stop_id: stopId, name: s.n },
    }))
    pushData('stops', { type: 'FeatureCollection', features })
  }, [stopsData])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    map.setFilter('stops-selected', ['==', ['get', 'stop_id'], selectedStopId ?? ''])
    if (selectedStopId && stopsData?.[selectedStopId]) {
      const s = stopsData[selectedStopId]
      map.easeTo({ center: [s.x, s.y], zoom: Math.max(map.getZoom(), 14.5), duration: 600 })
    }
  }, [selectedStopId, stopsData])

  // Apply mode filter to all layers
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const filter = modeFilter === 'all' ? null : ['==', ['get', 'mode'], modeFilter]
    for (const layer of ['shapes-line', 'vehicles-halo', 'vehicles-core', 'vehicles-label']) {
      map.setFilter(layer, filter)
    }
  }, [modeFilter])

  return <div ref={containerRef} className="map" />
}

/** Popup content: line, headsign + the next stops of this trip. */
function vehiclePopupHTML(props, ctx) {
  const { stopsData, arrivalsIndex } = ctx
  const color = MODES[props.mode]?.color ?? MODES.other.color
  const nextStops = (arrivalsIndex?.byTrip?.get(props.tripId) ?? [])
    .filter((s) => s.time * 1000 > Date.now() - 30_000)
    .slice(0, 3)
    .map((s) => {
      const name = stopsData?.[s.stopId]?.n ?? s.stopId
      return `<li>${escapeHtml(name)} <span class="eta">${formatEta(s.time - Date.now() / 1000)}</span></li>`
    })
  return `
    <div class="veh-popup">
      <div class="veh-head">
        <span class="line-badge" style="background:${color}">${escapeHtml(props.line)}</span>
        <span class="veh-headsign">${escapeHtml(props.headsign || '')}</span>
      </div>
      ${nextStops.length ? `<ul class="veh-next">${nextStops.join('')}</ul>` : ''}
      <div class="veh-id">${escapeHtml(props.id ?? '')}</div>
    </div>`
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}
