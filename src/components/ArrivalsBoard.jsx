import { MODES, formatEta } from '../lib/transport.js'

/** Live arrivals board for the selected stop. */
export default function ArrivalsBoard({ stop, arrivals, onClose, onRetry, error }) {
  if (!stop) return null
  return (
    <div className="arrivals-board">
      <div className="board-header">
        <div>
          <h2>{stop.n}</h2>
          {stop.c && <span className="stop-code">{stop.c}</span>}
        </div>
        <button className="board-close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>

      {error ? (
        <p className="board-empty board-error">Arrivals feed error: {error}</p>
      ) : arrivals.length === 0 ? (
        <p className="board-empty">No upcoming arrivals in the live feed right now.</p>
      ) : (
        <ul className="board-list" data-count={arrivals.length}>
          {arrivals.map((a, i) => (
            <li key={i} className="board-row">
              <span
                className="line-badge"
                style={{ background: a.color ?? MODES[a.mode]?.color ?? MODES.other.color }}
              >
                {a.line}
              </span>
              <span className="board-headsign" title={a.headsign}>
                {a.headsign || '—'}
              </span>
              <span className="board-eta">{formatEta(a.etaSec)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="board-footer">Live predictions · Center for Urban Mobility</p>
    </div>
  )
}
