import { ALERT_CAUSES, ALERT_EFFECTS, formatPeriod } from '../lib/transport.js'

/** Panel listing active service alerts, with affected line badges. */
export default function AlertsPanel({ alerts, routes, onClose }) {
  return (
    <div className="alerts-panel">
      <div className="board-header">
        <h2>
          Service alerts{alerts.length > 0 ? ` (${alerts.length})` : ''}
        </h2>
        <button className="board-close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>

      {alerts.length === 0 && <p className="board-empty">No active alerts right now.</p>}

      <ul className="alerts-list">
        {alerts.map((a) => {
          const lineRoutes = a.routeIds.map((id) => routes[id]).filter(Boolean)
          return (
            <li key={a.id} className="alert-item">
              <div className="alert-meta">
                <div className="alert-lines">
                  {lineRoutes.length > 0 ? (
                    lineRoutes.slice(0, 6).map((r, i) => (
                      <span
                        key={i}
                        className="line-badge"
                        style={{ background: r.c ? `#${r.c}` : undefined }}
                      >
                        {r.n}
                      </span>
                    ))
                  ) : (
                    <span className="alert-network">Network-wide</span>
                  )}
                </div>
                <span className="alert-tag">{ALERT_EFFECTS[a.effect] ?? 'Notice'}</span>
              </div>
              <div className="alert-sub">
                {ALERT_CAUSES[a.cause] ?? ''}
                {ALERT_CAUSES[a.cause] ? ' · ' : ''}
                {formatPeriod(a)}
              </div>
              <p className="alert-text">
                {a.text.length > 300 ? `${a.text.slice(0, 300)}…` : a.text}
              </p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
