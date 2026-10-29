import { useLang } from '../lib/i18n.jsx'
import { alertCauseLabel, alertEffectLabel, formatPeriod } from '../lib/transport.js'

/** Panel listing active service alerts, with affected line badges. */
export default function AlertsPanel({ alerts, routes, onClose }) {
  const { lang, t } = useLang()
  return (
    <div className="alerts-panel">
      <div className="board-header">
        <h2>
          {t('alertsTitle')}
          {alerts.length > 0 ? ` (${alerts.length})` : ''}
        </h2>
        <button className="board-close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>

      {alerts.length === 0 && <p className="board-empty">{t('alertsNone')}</p>}

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
                    <span className="alert-network">{t('networkWide')}</span>
                  )}
                </div>
                <span className="alert-tag">{alertEffectLabel(a.effect, lang)}</span>
              </div>
              <div className="alert-sub">
                {alertCauseLabel(a.cause, lang)}
                {alertCauseLabel(a.cause, lang) ? ' · ' : ''}
                {formatPeriod(a, lang)}
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
