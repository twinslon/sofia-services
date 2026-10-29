import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { MODES, SOFIA_CENTER, formatEta } from '../lib/transport.js'
import { POLLUTANTS, aqiBand } from '../lib/aq.js'

// OpenFreeMap: free vector tiles, no API key, no watermark
// https://openfreemap.org — styles: positron (light), dark, liberty, bright
const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'

const ACCENT = '#0969da'
const INK = '#1f2328'

const MODE_COLOR_STOPS = Object.entries(MODES).map(([mode, m]) => [mode, m.color])

// Vehicle animation: glide between polls; snap on GPS jumps / trip changes
// Tests run with ?static-vehicles to skip the rAF loop (CPU-heavy under
// software WebGL) — except the smooth-movement spec, which opts in.
const VEHICLE_TWEEN_MS = 9500
const VEHICLE_SNAP_M = 700
const TWEEN_FPS_MS = 40
const STATIC_VEHICLES = new URLSearchParams(globalThis.location?.search ?? '').has('static-vehicles')

function roughMeters(a, b) {
  return Math.hypot((b[0] - a[0]) * 82000, (b[1] - a[1]) * 111000)
}

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
  stopsById,
  liveStopIds,
  selectedStop,
  arrivals,
  onSelectStop,
  onStopClose,
  arrivalsIndex,
  service,
  aqFC,
  communityFC,
  lang,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const readyRef = useRef(false)
  const dataRef = useRef({ shapes: null, vehicles: null, stops: null })
  const propsRef = useRef({ stopsData, stopsById, arrivalsIndex, lang })
  const serviceRef = useRef(service)
  serviceRef.current = service
  const popupRef = useRef(null) // vehicle popup (transient)
  const boardRef = useRef(null) // stop board popup (persistent while selected)
  const callbacksRef = useRef({ onSelectStop, onStopClose })
  callbacksRef.current = { onSelectStop, onStopClose }
  propsRef.current = { stopsData, stopsById, arrivalsIndex, lang }

  const pushData = (which, fc) => {
    const map = mapRef.current
    if (!map || !readyRef.current || !fc) return
    map.getSource(which)?.setData(fc)
  }

  // ── Vehicle tweening ────────────────────────────────────────────────
  // On each new batch we animate from the currently displayed positions
  // to the new targets, so vehicles glide instead of jumping every poll.
  const animRef = useRef({ targets: null, from: new Map(), current: new Map(), raf: 0, start: 0, last: 0 })

  const tweenStep = () => {
    const st = animRef.current
    st.raf = 0
    const targets = st.targets
    if (!targets || !mapRef.current) return
    const now = performance.now()
    const t = Math.min(1, (now - st.start) / VEHICLE_TWEEN_MS)
    if (now - st.last < TWEEN_FPS_MS && t < 1) {
      st.raf = requestAnimationFrame(tweenStep)
      return
    }
    st.last = now
    const features = new Array(targets.features.length)
    const seen = new Set()
    for (let i = 0; i < targets.features.length; i++) {
      const f = targets.features[i]
      const id = f.properties.id
      seen.add(id)
      const to = f.geometry.coordinates
      const fr = st.from.get(id)
      // Snap (no glide) when there is no previous position or the vehicle
      // "jumped" — a GPS glitch or a different trip on the same line
      if (fr && roughMeters(fr, to) < VEHICLE_SNAP_M && t < 1) {
        const coords = [fr[0] + (to[0] - fr[0]) * t, fr[1] + (to[1] - fr[1]) * t]
        st.current.set(id, coords)
        features[i] = { ...f, geometry: { type: 'Point', coordinates: coords } }
      } else {
        st.current.set(id, to)
        features[i] = f
      }
    }
    for (const id of st.current.keys()) if (!seen.has(id)) st.current.delete(id)
    mapRef.current.getSource('vehicles')?.setData({ type: 'FeatureCollection', features })
    if (t < 1) st.raf = requestAnimationFrame(tweenStep)
  }

  const pushVehicles = (fc) => {
    if (!fc) return
    const st = animRef.current
    if (STATIC_VEHICLES) {
      if (st.raf) cancelAnimationFrame(st.raf)
      st.targets = fc
      st.current = new Map(fc.features.map((f) => [f.properties.id, f.geometry.coordinates]))
      mapRef.current?.getSource('vehicles')?.setData(fc)
      return
    }
    st.targets = fc
    st.from = new Map(st.current)
    st.start = performance.now()
    if (st.raf) cancelAnimationFrame(st.raf)
    st.raf = requestAnimationFrame(tweenStep)
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
      map.addSource('stops', {
        type: 'geojson',
        data: dataRef.current.stops ?? emptyFC(),
      })

      map.addLayer({
        id: 'shapes-line',
        type: 'line',
        source: 'shapes',
        paint: {
          'line-color': colorByMode(MODES.other.color),
          'line-opacity': 0.45,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 14, 1.8],
        },
      })

      // Lines with active service alerts — amber dashed overlay
      map.addLayer({
        id: 'shapes-alert',
        type: 'line',
        source: 'shapes',
        filter: ['==', ['get', 'alert'], true],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#d29922',
          'line-opacity': 0.9,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.6, 14, 3],
          'line-dasharray': [2, 1.4],
        },
      })

      // Bold stop circles — bigger than vehicles; stops without live
      // coverage (metro RT gaps, seasonal/night service) fade to dots
      map.addLayer({
        id: 'stops-dot',
        type: 'circle',
        source: 'stops',
        minzoom: 11,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            11,
            ['case', ['get', 'live'], 4, 2.5],
            12,
            ['case', ['get', 'live'], 5, 2.5],
            14,
            ['case', ['get', 'live'], 7, 3],
            16,
            ['case', ['get', 'live'], 9, 3.5],
          ],
          'circle-color': ['case', ['get', 'live'], INK, '#8c959f'],
          'circle-opacity': ['case', ['get', 'live'], 0.9, 0.35],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      })
      map.addLayer({
        id: 'stops-selected',
        type: 'circle',
        source: 'stops',
        paint: {
          'circle-radius': 9,
          'circle-color': ACCENT,
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        },
        filter: ['==', ['get', 'stop_id'], selectedStop?.id ?? ''],
      })

      map.addLayer({
        id: 'vehicles-halo',
        type: 'circle',
        source: 'vehicles',
        paint: {
          'circle-radius': 6,
          'circle-color': colorByMode(MODES.other.color),
          'circle-opacity': 0.3,
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
          'circle-stroke-width': 2,
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
          'text-color': INK,
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.6,
        },
      })

      // Air quality stations (visible in Air mode)
      map.addSource('aq', { type: 'geojson', data: emptyFC() })
      map.addLayer({
        id: 'aq-halo',
        type: 'circle',
        source: 'aq',
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 16],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.18,
          'circle-blur': 0.8,
        },
      })
      map.addLayer({
        id: 'aq-dot',
        type: 'circle',
        source: 'aq',
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 6, 14, 9],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.95,
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#ffffff',
        },
      })
      map.addLayer({
        id: 'aq-label',
        type: 'symbol',
        source: 'aq',
        layout: {
          visibility: 'none',
          'text-field': ['get', 'value'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-offset': [0, -2],
          'text-anchor': 'bottom',
        },
        paint: {
          'text-color': '#1f2328',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.5,
        },
      })

      // Citizen sensors (Sensor.Community) — smaller hollow dots
      map.addSource('community', { type: 'geojson', data: emptyFC() })
      map.addLayer({
        id: 'community-dot',
        type: 'circle',
        source: 'community',
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 14, 5],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.85,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
        },
      })

      // Interactions — one click handler, clear priority: vehicles > stops
      map.on('click', (e) => {
        if (serviceRef.current === 'air') {
          const stations = map.queryRenderedFeatures(e.point, { layers: ['aq-dot'] })
          if (stations.length > 0) {
            popupRef.current?.remove()
            popupRef.current = new maplibregl.Popup({ offset: 10, maxWidth: '280px' })
              .setLngLat(e.lngLat)
              .setHTML(aqPopupHTML(stations[0].properties, propsRef.current.lang))
              .addTo(map)
            return
          }
          const community = map.queryRenderedFeatures(e.point, { layers: ['community-dot'] })
          if (community.length > 0) {
            popupRef.current?.remove()
            popupRef.current = new maplibregl.Popup({ closeButton: false, offset: 8, maxWidth: '240px' })
              .setLngLat(e.lngLat)
              .setHTML(communityPopupHTML(community[0].properties, propsRef.current.lang))
              .addTo(map)
          }
          return
        }
        const vehicles = map.queryRenderedFeatures(e.point, { layers: ['vehicles-core'] })
        if (vehicles.length > 0) {
          popupRef.current?.remove()
          popupRef.current = new maplibregl.Popup({ closeButton: false, offset: 8, maxWidth: '260px' })
            .setLngLat(e.lngLat)
            .setHTML(vehiclePopupHTML(vehicles[0].properties, propsRef.current))
            .addTo(map)
          return
        }
        const stopFeatures = map.queryRenderedFeatures(e.point, { layers: ['stops-dot'] })
        if (stopFeatures.length > 0) {
          const stopId = stopFeatures[0].properties.stop_id
          if (stopId) callbacksRef.current.onSelectStop(stopId)
        }
      })
      map.on('mousemove', (e) => {
        const layers =
          serviceRef.current === 'air'
            ? ['aq-dot', 'community-dot']
            : ['vehicles-core', 'stops-dot']
        const hit = map.queryRenderedFeatures(e.point, { layers })
        map.getCanvas().style.cursor = hit.length > 0 ? 'pointer' : ''
      })

      readyRef.current = true
      // Exposed for debugging/E2E tests (queryRenderedFeatures etc.)
      window.__map = map
      map.resize()
      // Flush anything that arrived before the map finished loading
      pushData('shapes', dataRef.current.shapes)
      pushData('stops', dataRef.current.stops)
      pushVehicles(dataRef.current.vehicles)
    })

    return () => {
      readyRef.current = false
      cancelAnimationFrame(animRef.current.raf)
      popupRef.current?.remove()
      boardRef.current?.remove()
      map.remove()
      mapRef.current = null
      window.__map = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    dataRef.current.shapes = shapesFC
    pushData('shapes', shapesFC)
  }, [shapesFC])

  useEffect(() => {
    dataRef.current.vehicles = vehiclesFC
    if (!mapRef.current || !readyRef.current) return
    pushVehicles(vehiclesFC)
  }, [vehiclesFC])

  // Push stop markers (re-marked with live coverage on every poll)
  useEffect(() => {
    if (!stopsData) return
    const features = Object.entries(stopsData).map(([stopId, s]) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.x, s.y] },
      properties: { stop_id: stopId, name: s.n, live: liveStopIds ? liveStopIds.has(stopId) : true },
    }))
    const fc = { type: 'FeatureCollection', features }
    dataRef.current.stops = fc
    pushData('stops', fc)
  }, [stopsData, liveStopIds])

  // Selected stop: highlight, fly to, and open/update its board popup
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    map.setFilter('stops-selected', ['==', ['get', 'stop_id'], selectedStop?.id ?? ''])

    if (!selectedStop) {
      boardRef.current?.remove()
      boardRef.current = null
      return
    }

    const html = boardPopupHTML(selectedStop, arrivals, lang)
    if (boardRef.current?.isOpen()) {
      boardRef.current.setHTML(html)
    } else {
      boardRef.current?.remove()
      const board = new maplibregl.Popup({
        offset: 12,
        maxWidth: '320px',
        className: 'board-popup-wrap',
      })
      board.setLngLat([selectedStop.x, selectedStop.y]).setHTML(html)
      board.on('close', () => {
        if (boardRef.current) {
          boardRef.current = null
          callbacksRef.current.onStopClose?.()
        }
      })
      board.addTo(map)
      boardRef.current = board
    }
    map.easeTo({ center: [selectedStop.x, selectedStop.y], zoom: Math.max(map.getZoom(), 14.5), duration: 600 })
  }, [selectedStop, arrivals, lang])

  // Push air-quality stations (recolors on pollutant change)
  useEffect(() => {
    if (!aqFC) return
    const map = mapRef.current
    if (!map || !readyRef.current) return
    map.getSource('aq')?.setData(aqFC)
  }, [aqFC])

  // Push citizen sensors (cleared when the pollutant has no community data)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    map.getSource('community')?.setData(communityFC ?? emptyFC())
  }, [communityFC])

  // Service switch: transport layers <-> air quality layers
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const transport = ['shapes-line', 'shapes-alert', 'stops-dot', 'stops-selected', 'vehicles-halo', 'vehicles-core', 'vehicles-label']
    const air = ['aq-halo', 'aq-dot', 'aq-label', 'community-dot']
    const show = (layers, visible) => {
      for (const l of layers) {
        if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', visible ? 'visible' : 'none')
      }
    }
    const isAir = service === 'air'
    show(transport, !isAir)
    show(air, isAir)
    map.getCanvas().style.cursor = ''
  }, [service])

  // Apply mode filter to all layers
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const filter = modeFilter === 'all' ? null : ['==', ['get', 'mode'], modeFilter]
    for (const layer of ['shapes-line', 'shapes-alert', 'vehicles-halo', 'vehicles-core', 'vehicles-label']) {
      map.setFilter(layer, filter)
    }
  }, [modeFilter])

  return <div ref={containerRef} className="map" />
}

/** Arrivals board popup for a selected stop. */
function boardPopupHTML(stop, arrivals, lang) {
  const rows = (arrivals ?? [])
    .map(
      (a) => `
      <li class="board-row">
        <span class="line-badge" style="background:${a.color ?? 'var(--accent)'}">${escapeHtml(a.line)}</span>
        <span class="board-headsign" title="${escapeHtml(a.headsign)}">${escapeHtml(a.headsign || '—')}</span>
        <span class="board-eta">${escapeHtml(formatEta(a.etaSec))}</span>
      </li>`,
    )
    .join('')
  const body = arrivalsErrorOrEmpty(arrivals, lang)
  const footer = lang === 'bg' ? 'Живи прогнози · Център за градска мобилност' : 'Live predictions · Center for Urban Mobility'
  return `
    <div class="board-popup" data-count="${arrivals?.length ?? 0}">
      <div class="board-title">
        <h2>${escapeHtml(stop.n)}</h2>
        ${stop.cs?.length ? `<span class="stop-code">${escapeHtml(stop.cs.join(' · '))}</span>` : ''}
      </div>
      ${body ?? `<ul class="board-list">${rows}</ul>`}
      <div class="board-footer">${footer}</div>
    </div>`
}

function arrivalsErrorOrEmpty(arrivals, lang) {
  if (!arrivals) {
    return `<p class="board-empty">${lang === 'bg' ? 'Зареждане на пристиганията …' : 'Loading arrivals …'}</p>`
  }
  if (arrivals.length === 0) {
    return `<p class="board-empty">${
      lang === 'bg'
        ? 'Няма предстоящи пристигания в живите данни в момента.'
        : 'No upcoming arrivals in the live feed right now.'
    }</p>`
  }
  return null
}

/** Popup content: line, headsign + the next stops of this trip. */
function vehiclePopupHTML(props, ctx) {
  const { stopsById, arrivalsIndex } = ctx
  const color = MODES[props.mode]?.color ?? MODES.other.color
  const nextStops = (arrivalsIndex?.byTrip?.get(props.tripId) ?? [])
    .filter((s) => s.time * 1000 > Date.now() - 30_000)
    .slice(0, 3)
    .map((s) => {
      // RT stop ids may be either representative or original (merged) ids
      const name = stopsById?.[s.stopId]?.n ?? s.stopId
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

/** Air-quality station popup: all pollutants with band colors. */
function aqPopupHTML(props, lang) {  let values
  try {
    values = JSON.parse(props.values ?? '{}')
  } catch {
    values = {}
  }
  const rows = Object.entries(values)
    .map(([feedKey, r]) => {
      const meta = Object.values(POLLUTANTS).find((m) => m.key === feedKey) ?? { label: feedKey, unit: '' }
      const band = aqiBand(feedKey, r.v)
      return `<li>
        <span class="aq-band-dot" style="background:${band?.color ?? '#8c959f'}"></span>
        <span class="aq-poll">${escapeHtml(meta.label)}</span>
        <span class="aq-val">${r.v} ${escapeHtml(meta.unit)}</span>
        <span class="aq-band">${escapeHtml(band?.label ?? '—')}</span>
      </li>`
    })
    .join('')
  return `
    <div class="aq-popup">
      <div class="aq-head">
        <h2>${escapeHtml(props.name)}</h2>
        <span class="aq-code">${escapeHtml(props.code)}</span>
      </div>
      <div class="aq-sub">${escapeHtml(props.area ?? '')}</div>
      ${rows ? `<ul class="aq-list">${rows}</ul>` : `<p class="board-empty">${lang === 'bg' ? 'Няма текущи измервания.' : 'No current readings.'}</p>`}
      <div class="veh-id">${lang === 'bg' ? 'ИАОС официален мониторинг · на всеки час' : 'EEA official monitoring · hourly'}</div>
    </div>`
}

/** Citizen-sensor popup: PM readings + age + provenance. */
function communityPopupHTML(props) {
  const feedKey = 'PM10'
  const rows = []
  if (props.value != null) {
    const band = aqiBand(feedKey, props.value)
    rows.push(
      `<li><span class="aq-band-dot" style="background:${band?.color ?? '#8c959f'}"></span>` +
        `<span class="aq-poll">PM10</span><span class="aq-val">${props.value} µg/m³</span>` +
        `<span class="aq-band">${escapeHtml(band?.label ?? '')}</span></li>`,
    )
  }
  const ageMs = props.tsMs ? Date.now() - props.tsMs : null
  const mins = Math.max(0, Math.round(ageMs / 60000))
  const age = ageMs != null ? (lang === 'bg' ? `преди ${mins} мин` : `${mins} min ago`) : ''
  const title = lang === 'bg' ? `Граждански сензор №${escapeHtml(props.sid)}` : `Citizen sensor #${escapeHtml(props.sid)}`
  const footer = lang === 'bg' ? 'Sensor.Community · нискобюджетен сензор' : 'Sensor.Community · low-cost sensor'
  const indicative = lang === 'bg' ? 'индикативно' : 'indicative'
  return `
    <div class="aq-popup">
      <div class="aq-head">
        <h2>${title}</h2>
      </div>
      <div class="aq-sub">${escapeHtml(props.type ?? '')} · ${indicative}${age ? ` · ${age}` : ''}</div>
      ${rows.length ? `<ul class="aq-list">${rows.join('')}</ul>` : ''}
      <div class="veh-id">${footer}</div>
    </div>`
}
