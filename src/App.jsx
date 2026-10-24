import { useEffect, useMemo, useRef, useState } from 'react'
import MapView from './components/MapView.jsx'
import {
  MODES,
  RT_URLS,
  buildShapeFeatures,
  buildVehicleFeatures,
  extractVehicles,
  fetchRealtimeFeed,
} from './lib/transport.js'

const POLL_INTERVAL_MS = 10_000
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
  const [modeFilter, setModeFilter] = useState('all')
  const [status, setStatus] = useState({ state: 'loading', count: 0, updatedAt: null })

  // Load the prepared static GTFS extracts
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [routes, trips, shapes, meta] = await Promise.all(
          ['routes', 'trips', 'shapes', 'meta'].map((n) =>
            fetch(`${import.meta.env.BASE_URL}data/${n}.json`).then((r) => {
              if (!r.ok) throw new Error(`${n}.json: HTTP ${r.status} — run "npm run prepare-data"`)
              return r.json()
            }),
          ),
        )
        if (!cancelled) setStaticData({ routes, trips, shapes, meta })
      } catch (err) {
        if (!cancelled) setStatus((s) => ({ ...s, state: 'error', message: String(err.message || err) }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Poll the real-time vehicle positions feed
  useEffect(() => {
    let cancelled = false
    let timer

    const poll = async () => {
      try {
        const entities = await fetchRealtimeFeed(RT_URLS.vehiclePositions)
        if (cancelled) return
        const vehicles = extractVehicles(entities)
        setVehiclesFC((prev) => {
          // Enrich once static data is available; raw FC otherwise
          return staticData
            ? buildVehicleFeatures(vehicles, staticData)
            : { type: 'FeatureCollection', features: [] }
        })
        setStatus({ state: 'ok', count: vehicles.length, updatedAt: new Date() })
      } catch (err) {
        if (!cancelled) setStatus((s) => ({ ...s, state: 'error', message: String(err.message || err) }))
      } finally {
        if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS)
      }
    }

    poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [staticData])

  const shapesFC = useMemo(
    () => (staticData ? buildShapeFeatures(staticData) : null),
    [staticData],
  )

  const modeCounts = useMemo(() => {
    const counts = {}
    for (const f of vehiclesFC?.features ?? []) counts[f.properties.mode] = (counts[f.properties.mode] || 0) + 1
    return counts
  }, [vehiclesFC])

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

        <div className={`status status-${status.state}`}>
          {status.state === 'loading' && 'Connecting to live feed …'}
          {status.state === 'ok' &&
            `${status.count} vehicles · updated ${status.updatedAt.toLocaleTimeString()}`}
          {status.state === 'error' && `Feed error: ${status.message}`}
        </div>
      </header>

      <main className="map-wrap">
        <MapView shapesFC={shapesFC} vehiclesFC={vehiclesFC} modeFilter={modeFilter} />
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
