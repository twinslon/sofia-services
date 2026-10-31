import { useEffect, useMemo, useState } from 'react'
import MapView from './components/MapView.jsx'
import StopSearch from './components/StopSearch.jsx'
import AlertsPanel from './components/AlertsPanel.jsx'
import LinePicker from './components/LinePicker.jsx'
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
import { useLang, LANGS } from './lib/i18n.jsx'
import { PARKING_LAYERS, buildParkingFC } from './lib/parking.js'
import { initAnalytics, trackPage } from './lib/analytics.js'
import { POLLUTANTS, UI_KEY_TO_FEED, aqiBand, aqiBandLabel, aqiBandScale, buildAqFeatures, buildCommunityFeatures } from './lib/aq.js'

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
  const { lang, setLang, t } = useLang()
  useEffect(() => initAnalytics(), [])
  const [staticData, setStaticData] = useState(null)
  const [vehiclesFC, setVehiclesFC] = useState(null)
  const [arrivalsIndex, setArrivalsIndex] = useState(null)
  const [selectedStopId, setSelectedStopId] = useState(null)
  const [selectedRouteId, setSelectedRouteId] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [modeFilter, setModeFilter] = useState('all')
  const [alerts, setAlerts] = useState(null)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [service, setService] = useState('transport') // 'transport' | 'air'
  const [pollutant, setPollutant] = useState('PM10')
  const [aqData, setAqData] = useState(null)
  const [scData, setScData] = useState(null)
  const [parkingData, setParkingData] = useState(null)
  const [parkingLayers, setParkingLayers] = useState(() => new Set(['bike', 'car', 'ev']))
  const [status, setStatus] = useState({ state: 'loading', count: 0, updatedAt: null })

  // Load the prepared static GTFS extracts
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [routes, trips, shapes, stops, aliases, lines, meta] = await Promise.all(
          ['routes', 'trips', 'shapes', 'stops', 'stop-aliases', 'lines', 'meta'].map((n) =>
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
          setStaticData({ routes, trips, shapes, stops, stopsById, stopIdToRep, lines, meta })
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

  // Parking (OSM bake, daily): load once on entering Parking mode
  useEffect(() => {
    if (service !== 'parking') return
    let cancelled = false
    fetch(`${import.meta.env.BASE_URL}data/parking.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => !cancelled && setParkingData(d))
      .catch(() => !cancelled && setParkingData({ features: [] }))
    return () => {
      cancelled = true
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

  // Air-mode FC and parking-mode FC
  const aqFC = useMemo(() => (service === 'air' ? buildAqFeatures(aqData, pollutant) : null), [
    service,
    aqData,
    pollutant,
  ])

  const parkingFC = useMemo(
    () => (service === 'parking' ? buildParkingFC(parkingData, parkingLayers) : null),
    [service, parkingData, parkingLayers],
  )

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
                  ? t('taglineTransport', { n: staticData.meta.counts.routes })
                  : t('taglineLoading')
                : service === 'air'
                  ? t('taglineAir')
                  : t('taglineParking')}
            </p>
          </div>
        </div>

        <div className="service-switch" role="tablist" aria-label="Service">
          {['transport', 'air', 'parking'].map((s) => (
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
              {t(s === 'transport' ? 'transportTab' : s === 'air' ? 'airTab' : 'parkingTab')}
            </button>
          ))}
        </div>

        {service === 'transport' && staticData && (
          <>
            <button
              className={`header-btn ${pickerOpen ? 'header-btn-active' : ''}`}
              aria-label={t('linesButton')}
              onClick={() => setPickerOpen((o) => !o)}
            >
              ☰ {t('linesButton')}
            </button>
            <StopSearch stops={staticData.stops} onSelect={(id) => setSelectedStopId(id)} />
          </>
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
                {t(`filter${f.key[0].toUpperCase()}${f.key.slice(1)}`)}
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

        {service === 'parking' && (
          <nav className="filters" aria-label="Parking layers">
            {PARKING_LAYERS.map((l) => (
              <button
                key={l.key}
                className={`chip ${parkingLayers.has(l.key) ? 'chip-active' : ''}`}
                onClick={() =>
                  setParkingLayers((prev) => {
                    const next = new Set(prev)
                    if (next.has(l.key)) next.delete(l.key)
                    else next.add(l.key)
                    return next
                  })
                }
              >
                <span className="dot" style={{ background: l.color }} />
                {lang === 'bg' ? l.bg : l.label}
              </button>
            ))}
          </nav>
        )}

        {service === 'transport' && alerts && (
          <button
            className={`bell ${alertsOpen ? 'bell-active' : ''}`}
            aria-label={`${t('bellAria')}${alerts.length ? ` (${alerts.length})` : ''}`}
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
              ? t('airStatusUpdated', { time: aqUpdated.toLocaleTimeString() })
              : t('airStatusLoading')
            : service === 'parking'
              ? parkingData
                ? t('parkingStatus', {
                    n: parkingData.features.length,
                    date: new Date(parkingData.generated_at).toLocaleDateString(),
                  })
                : t('parkingLoading')
            : status.state === 'loading'
              ? t('statusConnecting')
              : status.state === 'ok'
                ? t('statusVehicles', { n: status.count, time: status.updatedAt.toLocaleTimeString() })
                : t('statusFeedError', { msg: status.message })}
        </div>

        <div className="lang-switch" role="group" aria-label="Language">
          {LANGS.map((l) => (
            <button
              key={l.code}
              className={`lang-btn ${lang === l.code ? 'lang-active' : ''}`}
              onClick={() => setLang(l.code)}
            >
              {l.label}
            </button>
          ))}
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
          parkingFC={parkingFC}
          lang={lang}
          selectedRouteId={selectedRouteId}
          focusBounds={routeFocusBounds}
        />

        {pickerOpen && staticData && (
          <div className="alerts-wrap">
            <LinePicker
              lines={staticData.lines}
              routes={staticData.routes}
              onSelect={(routeId) => {
                setSelectedRouteId(routeId)
                setPickerOpen(false)
              }}
              onClose={() => setPickerOpen(false)}
            />
          </div>
        )}

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

        {service === 'air' && (
          <div className="aq-legend">
            <div className="aq-legend-title">
              {t('legendWorst', { p: POLLUTANTS[pollutant]?.label, level: aqiBandLabel(aqBandForSelected, lang) })}
            </div>
            <ul>
              {aqiBandScale().map((b) => (
                <li key={b.level}>
                  <span className="aq-band-dot" style={{ background: b.color }} />
                  {aqiBandLabel(b, lang)}
                </li>
              ))}
            </ul>
            {(['PM10', 'PM2_5'].includes(pollutant)) && (
              <div className="aq-legend-note">
                <span className="community-dot-sample" /> {t('legendCitizen')}
              </div>
            )}
            {aqUpdated && <div className="aq-legend-note">{t('legendOfficial', { time: aqUpdated.toLocaleTimeString() })}</div>}
          </div>
        )}

        {alertsOpen && staticData && (
          <div className="alerts-wrap">
            <AlertsPanel alerts={alerts ?? []} routes={staticData.routes} lang={lang} onClose={() => setAlertsOpen(false)} />
          </div>
        )}

        <footer className="attribution">
          {service === 'air' ? (
            <>
              {t('attributionStations')} ·{' '}
              <a href="https://sensor.community" target="_blank" rel="noreferrer">
                Sensor.Community
              </a>{' '}
              (CC BY-SA) · Map © OpenStreetMap contributors · Tiles{' '}
              <a href="https://openfreemap.org" target="_blank" rel="noreferrer">
                OpenFreeMap
              </a>
            </>
          ) : (
            <>
              {t('attributionData')}{' '}
              <a href="https://www.sofiatraffic.bg/bg/info-center/gtfs-danni" target="_blank" rel="noreferrer">
                (Sofia Traffic)
              </a>{' '}
              · CC-BY-4.0 · Map © OpenStreetMap contributors · Tiles{' '}
              <a href="https://openfreemap.org" target="_blank" rel="noreferrer">
                OpenFreeMap
              </a>
            </>
          )}
          {' · '}
          <a href={`${import.meta.env.BASE_URL}about.html`}>{t('aboutLink')}</a>
        </footer>
      </main>
    </div>
  )
}
