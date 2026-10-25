import { useEffect, useMemo, useState } from 'react'
import MapView from './components/MapView.jsx'
import StopSearch from './components/StopSearch.jsx'
import AlertsPanel from './components/AlertsPanel.jsx'
import LineExplorer from './components/LineExplorer.jsx'
import {
  MODES,
  RT_URLS,
  arrivalsForStop,
  buildArrivalsIndex,
  buildShapeFeatures,
  buildVehicleFeatures,
  extractAlerts,
  extractVehicles,
  fetchRealtimeFeed,
} from './lib/transport.js'

const POLL_INTERVAL_MS = 10_000
const ALERTS_POLL_INTERVAL_MS = 60_000
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'metro', label: 'Metro' },
  { key: 'tram', label: 'Trams' },
  { key: 'trolley', label: 'Trolleybuses' },
  { key: 'bus', label: 'Buses' },
]

export default function App() {
  const [staticData, setStaticData] = useState(null)
  const [vehiclesFC, setVehiclesFC] = useState(null)
  const [arrivalsIndex, setArrivalsIndex] = useState(null)
  const [selectedStopId, setSelectedStopId] = useState(null)
  const [selectedRouteId, setSelectedRouteId] = useState(null)
  const [modeFilter, setModeFilter] = useState('all')
  const [alerts, setAlerts] = useState(null)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [status, setStatus] = useState({ state: 'loading', count: 0, updatedAt: null })

  // Load the prepared static GTFS extracts
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [routes, trips, shapes, stops, lines, meta] = await Promise.all(
          ['routes', 'trips', 'shapes', 'stops', 'lines', 'meta'].map((n) =>
            fetch(`${import.meta.env.BASE_URL}data/${n}.json`).then((r) => {
              if (!r.ok) throw new Error(`${n}.json: HTTP ${r.status} — run "npm run prepare-data"`)
              return r.json()
            }),
          ),
        )
        if (!cancelled) setStaticData({ routes, trips, shapes, stops, lines, meta })
      } catch (err) {
        if (!cancelled) setStatus((s) => ({ ...s, state: 'error', message: String(err.message || err) }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Poll both real-time feeds (vehicles + trip updates)
  useEffect(() => {
    let cancelled = false
    let timer

    const poll = async () => {
      const [vpRes, tuRes] = await Promise.allSettled([
        fetchRealtimeFeed(RT_URLS.vehiclePositions),
        fetchRealtimeFeed(RT_URLS.tripUpdates),
      ])
      if (cancelled) return

      if (vpRes.status === 'fulfilled') {
        const vehicles = extractVehicles(vpRes.value)
        setVehiclesFC(
          staticData
            ? buildVehicleFeatures(vehicles, staticData)
            : { type: 'FeatureCollection', features: [] },
        )
        setStatus({ state: 'ok', count: vehicles.length, updatedAt: new Date() })
      } else {
        setStatus((s) => ({ ...s, state: 'error', message: String(vpRes.reason?.message || vpRes.reason) }))
      }

      if (tuRes.status === 'fulfilled') {
        setArrivalsIndex(buildArrivalsIndex(tuRes.value))
      }

      if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS)
    }

    poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [staticData])

  // Poll the alerts feed on a slower cadence (it changes rarely)
  useEffect(() => {
    let cancelled = false
    let timer
    const poll = async () => {
      try {
        const entities = await fetchRealtimeFeed(RT_URLS.alerts)
        if (!cancelled) setAlerts(extractAlerts(entities))
      } catch {
        /* keep the last good alerts; the bell simply stays hidden until one succeeds */
      } finally {
        if (!cancelled) timer = setTimeout(poll, ALERTS_POLL_INTERVAL_MS)
      }
    }
    poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  // Camera bounds of the selected line (from its stop coordinates)
  const routeFocusBounds = useMemo(() => {
    if (!selectedRouteId || !staticData) return null
    const coords = Object.values(staticData.lines[selectedRouteId] ?? {}).flatMap((d) =>
      d.stops.map((id) => staticData.stops[id]).filter(Boolean).map((s) => [s.x, s.y]),
    )
    if (coords.length === 0) return null
    const xs = coords.map((c) => c[0])
    const ys = coords.map((c) => c[1])
    return [
      [Math.min(...xs), Math.min(...ys)],
      [Math.max(...xs), Math.max(...ys)],
    ]
  }, [selectedRouteId, staticData])

  const shapesFC = useMemo(() => {
    if (!staticData) return null
    const alertRouteIds = new Set((alerts ?? []).flatMap((a) => a.routeIds))
    return buildShapeFeatures(staticData, alertRouteIds)
  }, [staticData, alerts])

  const modeCounts = useMemo(() => {
    const counts = {}
    for (const f of vehiclesFC?.features ?? []) counts[f.properties.mode] = (counts[f.properties.mode] || 0) + 1
    return counts
  }, [vehiclesFC])

  const selectedStop = useMemo(() => {
    if (!selectedStopId || !staticData) return null
    const s = staticData.stops[selectedStopId]
    return s ? { id: selectedStopId, ...s } : null
  }, [selectedStopId, staticData])

  const arrivals = useMemo(() => {
    if (!selectedStop || !arrivalsIndex || !staticData) return null
    // Re-derive whenever a poll lands (status.updatedAt changes) to refresh ETAs
    return arrivalsForStop(selectedStop, arrivalsIndex, staticData)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStop, arrivalsIndex, staticData, status.updatedAt])

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="brand-mark">◈</span>
          <div>
            <h1>Sofia Services</h1>
            <p className="tagline">
              {staticData
                ? `${staticData.meta.counts.routes} lines · live city services, starting with public transport`
                : 'Loading network data …'}
            </p>
          </div>
        </div>

        {staticData && (
          <StopSearch stops={staticData.stops} onSelect={(id) => setSelectedStopId(id)} />
        )}

        <nav className="filters" aria-label="Filter by mode">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`chip ${modeFilter === f.key ? 'chip-active' : ''}`}
              onClick={() => setModeFilter(f.key)}
            >
              {f.key !== 'all' && <span className="dot" style={{ background: MODES[f.key].color }} />}
              {f.label}
              {f.key !== 'all' && modeCounts[f.key] ? <span className="count">{modeCounts[f.key]}</span> : null}
            </button>
          ))}
        </nav>

        {alerts && (
          <button
            className={`bell ${alertsOpen ? 'bell-active' : ''}`}
            aria-label={`Service alerts${alerts.length ? ` (${alerts.length})` : ''}`}
            onClick={() => setAlertsOpen((o) => !o)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.7 21a2 2 0 0 1-3.4 0" />
            </svg>
            {alerts.length > 0 && <span className="bell-count">{alerts.length}</span>}
          </button>
        )}

        <div className={`status status-${status.state}`}>
          {status.state === 'loading' && 'Connecting to live feed …'}
          {status.state === 'ok' &&
            `${status.count} vehicles · updated ${status.updatedAt.toLocaleTimeString()}`}
          {status.state === 'error' && `Feed error: ${status.message}`}
        </div>
      </header>

      <main className="map-wrap">
        <MapView
          shapesFC={shapesFC}
          vehiclesFC={vehiclesFC}
          modeFilter={modeFilter}
          stopsData={staticData?.stops}
          selectedStop={selectedStop}
          arrivals={arrivals}
          onSelectStop={setSelectedStopId}
          onStopClose={() => setSelectedStopId(null)}
          selectedRouteId={selectedRouteId}
          focusBounds={routeFocusBounds}
          onRouteSelect={setSelectedRouteId}
          arrivalsIndex={arrivalsIndex}
        />

        {selectedRouteId && staticData && (
          <div className="alerts-wrap">
            <LineExplorer
              routeId={selectedRouteId}
              route={staticData.routes[selectedRouteId]}
              lines={staticData.lines}
              stops={staticData.stops}
              trips={staticData.trips}
              arrivalsIndex={arrivalsIndex}
              alerts={alerts}
              onSelectStop={setSelectedStopId}
              onClose={() => setSelectedRouteId(null)}
            />
          </div>
        )}

        {alertsOpen && staticData && !selectedRouteId && (
          <div className="alerts-wrap">
            <AlertsPanel alerts={alerts ?? []} routes={staticData.routes} onClose={() => setAlertsOpen(false)} />
          </div>
        )}

        <footer className="attribution">
          Data:{' '}
          <a href="https://www.sofiatraffic.bg/bg/info-center/gtfs-danni" target="_blank" rel="noreferrer">
            Center for Urban Mobility (Sofia Traffic)
          </a>{' '}
          · CC-BY-4.0 · Map © OpenStreetMap contributors · Tiles{' '}
          <a href="https://openfreemap.org" target="_blank" rel="noreferrer">
            OpenFreeMap
          </a>
        </footer>
      </main>
    </div>
  )
}
