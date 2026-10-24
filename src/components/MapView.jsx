import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { MODES, SOFIA_CENTER } from '../lib/transport.js'

const BASEMAP_STYLE = {
  version: 8,
  sources: {
    basemap: {
      type: 'raster',
      tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        '© OpenStreetMap contributors © CARTO',
    },
  },
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#0d1117' } },
    { id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-opacity': 0.9 } },
  ],
}

const MODE_COLOR_STOPS = Object.entries(MODES).map(([mode, m]) => [mode, m.color])

function colorByMode(fallback) {
  return ['coalesce', ['get', 'color'], ['match', ['get', 'mode'], ...MODE_COLOR_STOPS.flat(), fallback]]
}

export default function MapView({ shapesFC, vehiclesFC, modeFilter }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const readyRef = useRef(false)
  const dataRef = useRef({ shapes: null, vehicles: null })

  // Push data into a map source only once the map is loaded; otherwise
  // it is kept in dataRef and flushed by the 'load' handler (race-safe).
  const pushData = (which, fc) => {
    const map = mapRef.current
    if (!map || !readyRef.current || !fc) return
    map.getSource(which)?.setData(fc)
  }

  // Create the map once
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
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
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Keep the latest data in refs and push whenever it changes
  useEffect(() => {
    dataRef.current.shapes = shapesFC
    pushData('shapes', shapesFC)
  }, [shapesFC])

  useEffect(() => {
    dataRef.current.vehicles = vehiclesFC
    pushData('vehicles', vehiclesFC)
  }, [vehiclesFC])

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

function emptyFC() {
  return { type: 'FeatureCollection', features: [] }
}
