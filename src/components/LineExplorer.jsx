import { useMemo } from 'react'
import { MODES, ROUTE_TYPE_TO_MODE } from '../lib/transport.js'
import { useLang } from '../lib/i18n.jsx'

/** Line explorer: directions, live next departures, ordered stops. */
export default function LineExplorer({ routeId, route, lines, stops, trips, arrivalsIndex, alerts, onSelectStop, onClose }) {
  const { lang, t } = useLang()
  const directions = lines[routeId] ?? {}
  const mode = ROUTE_TYPE_TO_MODE[route?.t] ?? 'other'
  const color = route?.c ? `#${route.c}` : MODES[mode]?.color
  const routeAlerts = (alerts ?? []).filter((a) => a.routeIds.includes(routeId))

  const departuresByHeadsign = useMemo(() => {
    const now = Date.now() / 1000
    const out = new Map() // headsign -> [{ time, running }]
    for (const [tripId, stopTimes] of arrivalsIndex?.byTrip ?? []) {
      const trip = trips[tripId]
      if (!trip || trip.r !== routeId) continue
      const first = stopTimes[0]
      if (!first || first.time < now - 120) continue
      const list = out.get(trip.h) ?? []
      list.push({ time: first.time, running: first.time < now + 60 })
      out.set(trip.h, list)
    }
    for (const list of out.values()) list.sort((a, b) => a.time - b.time)
    return out
    // refresh when a poll lands
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId, arrivalsIndex])

  const stopsLabel = (n) => (lang === 'bg' ? `${n} спирки` : `${n} stops`)

  return (
    <div className="line-panel">
      <div className="board-header">
        <div className="line-title">
          <span className="line-badge line-badge-lg" style={{ background: color }}>
            {route?.n ?? routeId}
          </span>
          <div>
            <h2>{route?.ln?.trim() || route?.n || routeId}</h2>
            <span className="line-sub">
              {MODES[mode]?.label ?? 'Line'}
              {routeAlerts.length > 0 && ` · ${t('lineAlerts', { n: routeAlerts.length })}`}
            </span>
          </div>
        </div>
        <button className="board-close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>

      {Object.entries(directions).map(([headsign, dir]) => (
        <section className="line-dir" key={headsign}>
          <div className="dir-head">
            <h3>→ {headsign}</h3>
            <span className="dir-count">{stopsLabel(dir.n)}</span>
          </div>

          {(() => {
            const deps = (departuresByHeadsign.get(headsign) ?? []).slice(0, 3)
            if (deps.length > 0) {
              return (
                <div className="dir-departures">
                  {deps.map((d, i) => (
                    <span key={i} className={`dep ${d.running ? 'dep-running' : ''}`}>
                      {d.running ? t('depRunning') : fmtTime(d.time)}
                    </span>
                  ))}
                </div>
              )
            }
            return null
          })()}

          <ol className="dir-stops">
            {dir.stops.map((stopId) => {
              const stop = stops[stopId]
              if (!stop) return null
              return (
                <li key={stopId}>
                  <button onClick={() => onSelectStop(stopId)} title={stop.cs?.join(' · ')}>
                    <span className="stop-seq" aria-hidden="true" />
                    <span className="stop-name">{stop.n}</span>
                    {(stop.cs ?? []).slice(0, 2).map((c) => (
                      <span key={c} className="stop-code">
                        {c}
                      </span>
                    ))}
                  </button>
                </li>
              )
            })}
          </ol>
        </section>
      ))}

      {Object.keys(directions).length === 0 && (
        <p className="board-empty">{t('lineNoSequence')}</p>
      )}
    </div>
  )
}

function fmtTime(unixSec) {
  const d = new Date(unixSec * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
