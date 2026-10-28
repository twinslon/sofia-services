import { useEffect, useMemo, useState } from 'react'
import MapView from './components/MapView.jsx'
import StopSearch from './components/StopSearch.jsx'
import AlertsPanel from './components/AlertsPanel.jsx'
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
import { POLLUTANTS, UI_KEY_TO_FEED, aqiBand, aqiBandScale, buildAqFeatures, buildCommunityFeatures } from './lib/aq.js'

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
  const [modeFilter, setModeFilter] = useState('all')
  const [alerts, setAlerts] = useState(null)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [service, setService] = useState('transport') // 'transport' | 'air'
  const [pollutant, setPollutant] = useState('PM10')
  const [aqData, setAqData] = useState(null)
  const [scData, setScData] = useState(null)
  const [status, setStatus] = useState({ state: 'loading', count: 0, updatedAt: null })

  // Load the prepared static GTFS extracts
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [routes, trips, shapes, stops, aliases, meta] = await Promise.all(
          ['routes', 'trips', 'shapes', 'stops', 'stop-aliases', 'meta'].map((n) =>
            fetch(`${import.meta.env.BASE_URL}data/${n}.json`).then((r) => {
              if (!r.ok) throw new Error(`${n}.json: HTTP ${r.status} — run "npm run prepare-data"`)
              return r.json()
            }),
          ),
        )
        if (!cancelled) {
          // Flat lookups: original stop ids (RT feed) -> stop entry, and -> rep id
          const stopsById = { ...stops }
          const stopIdToRep = {}
          for (const [repId, s] of Object.entries(stops)) {
            stopsById[repId] = s
            stopIdToRep[repId] = repId
          }
          for (const [orig, rep] of Object.entries(aliases)) {
            if (stops[rep]) {
              stopsById[orig] = stops[rep]
              stopIdToRep[orig] = rep
            }
          }
          setStaticData({ routes, trips, shapes, stops, stopsById, stopIdToRep, meta })
        }
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

  // Load air quality snapshot (baked hourly by CI)
  useEffect(() => {
    let cancelled = false
    fetch(`${import.meta.env.BASE_URL}data/aq.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => !cancelled && setAqData(d))
      .catch(() => !cancelled && setAqData({ stations: [] }))
    return () => {
      cancelled = true
    }
  }, [])

  // Citizen sensors (Sensor.Community): fetch the baked Sofia subset when
  // entering Air mode, refresh every 5 min while there
  useEffect(() => {
    if (service !== 'air') return
    let cancelled = false
    let timer
    const poll = async () => {
      try {
        const d = await fetch(`${import.meta.env.BASE_URL}data/sc-sofia.json`).then((r) =>
          r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
        )
        if (!cancelled) setScData(d)
      } catch {
        /* keep last good data */
      } finally {
        if (!cancelled) timer = setTimeout(poll, 5 * 60_000)
      }
    }
    poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [service])

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

  // Which stops (reps) have live arrivals right now — from the trip-updates index
  const liveStopIds = useMemo(() => {
    const covered = new Set()
    const byStop = arrivalsIndex?.byStop
    const toRep = staticData?.stopIdToRep
    if (!byStop || !toRep) return covered
    for (const stopId of byStop.keys()) {
      const rep = toRep[stopId]
      if (rep) covered.add(rep)
    }
    return covered
  }, [arrivalsIndex, staticData])

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

  const aqFC = useMemo(() => (service === 'air' ? buildAqFeatures(aqData, pollutant) : null), [
    service,
    aqData,
    pollutant,
  ])

  const communityFC = useMemo(
    () => (service === 'air' ? buildCommunityFeatures(scData, pollutant) : null),
    [service, scData, pollutant],
  )

  const aqUpdated = aqData?.generated_at ? new Date(aqData.generated_at) : null
  const aqBandForSelected = useMemo(() => {
    const feedKey = UI_KEY_TO_FEED[pollutant]
    const stations = (aqData?.stations ?? []).map((s) => s.values?.[feedKey]).filter(Boolean)
    const bands = stations.map((r) => aqiBand(feedKey, r.v)).filter(Boolean)
    return bands.length ? bands.sort((a, b) => b.level.localeCompare(a.level))[0] : null
  }, [aqData, pollutant])

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="brand-mark">◈</span>
          <div>
            <h1>Sofia Services</h1>
            <p className="tagline">
              {service === 'transport'
                ? staticData
                  ? `${staticData.meta.counts.routes} lines · live city services, starting with public transport`
                  : 'Loading network data …'
                : 'Official air quality monitoring · EEA'}
            </p>
          </div>
        </div>

        <div className="service-switch" role="tablist" aria-label="Service">
          {['transport', 'air'].map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={service === s}
              className={`switch-btn ${service === s ? 'switch-active' : ''}`}
              onClick={() => {
                setService(s)
                if (s === 'air') setSelectedStopId(null)
              }}
            >
              {s === 'transport' ? 'Transport' : 'Air'}
            </button>
          ))}
        </div>

        {service === 'transport' && staticData && (
          <StopSearch stops={staticData.stops} onSelect={(id) => setSelectedStopId(id)} />
        )}

        {service === 'transport' && (
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
        )}

        {service === 'air' && (
          <nav className="filters" aria-label="Pollutant">
            {Object.entries(POLLUTANTS).map(([uiKey, p]) => (
              <button
                key={uiKey}
                className={`chip ${pollutant === uiKey ? 'chip-active' : ''}`}
                onClick={() => setPollutant(uiKey)}
              >
                {p.label}
              </button>
            ))}
          </nav>
        )}

        {service === 'transport' && alerts && (
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
          {service === 'air'
            ? aqUpdated
              ? `Air quality · updated ${aqUpdated.toLocaleTimeString()} · hourly`
              : 'Loading air quality …'
            : status.state === 'loading'
              ? 'Connecting to live feed …'
              : status.state === 'ok'
                ? `${status.count} vehicles · updated ${status.updatedAt.toLocaleTimeString()}`
                : `Feed error: ${status.message}`}
        </div>
      </header>

      <main className="map-wrap">
        <MapView
          shapesFC={shapesFC}
          vehiclesFC={vehiclesFC}
          modeFilter={modeFilter}
          stopsData={staticData?.stops}
          stopsById={staticData?.stopsById}
          liveStopIds={liveStopIds}
          selectedStop={selectedStop}
          arrivals={arrivals}
          onSelectStop={setSelectedStopId}
          onStopClose={() => setSelectedStopId(null)}
          arrivalsIndex={arrivalsIndex}
          service={service}
          aqFC={aqFC}
          communityFC={communityFC}
        />

        {service === 'air' && (
          <div className="aq-legend">
            <div className="aq-legend-title">{POLLUTANTS[pollutant]?.label} · worst now: {aqBandForSelected?.label ?? '—'}</div>
            <ul>
              {aqiBandScale().map((b) => (
                <li key={b.level}>
                  <span className="aq-band-dot" style={{ background: b.color }} />
                  {b.label}
                </li>
              ))}
            </ul>
            {(['PM10', 'PM2_5'].includes(pollutant)) && (
              <div className="aq-legend-note">
                <span className="community-dot-sample" /> citizen sensor (indicative)
              </div>
            )}
            {aqUpdated && <div className="aq-legend-note">official: {aqUpdated.toLocaleTimeString()}</div>}
          </div>
        )}

        {alertsOpen && staticData && (
          <div className="alerts-wrap">
            <AlertsPanel alerts={alerts ?? []} routes={staticData.routes} onClose={() => setAlertsOpen(false)} />
          </div>
        )}

        <footer className="attribution">
          {service === 'air' ? (
            <>
              Stations: EEA (official) ·{' '}
              <a href="https://sensor.community" target="_blank" rel="noreferrer">
                Sensor.Community
              </a>{' '}
              citizen sensors (CC BY-SA) · Map © OpenStreetMap contributors · Tiles{' '}
              <a href="https://openfreemap.org" target="_blank" rel="noreferrer">
                OpenFreeMap
              </a>
            </>
          ) : (
            <>
              Data:{' '}
              <a href="https://www.sofiatraffic.bg/bg/info-center/gtfs-danni" target="_blank" rel="noreferrer">
                Center for Urban Mobility (Sofia Traffic)
              </a>{' '}
              · CC-BY-4.0 · Map © OpenStreetMap contributors · Tiles{' '}
              <a href="https://openfreemap.org" target="_blank" rel="noreferrer">
                OpenFreeMap
              </a>
            </>
          )}
        </footer>
      </main>
    </div>
  )
}
