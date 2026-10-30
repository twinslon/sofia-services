import { useMemo, useState } from 'react'
import { MODES, ROUTE_TYPE_TO_MODE } from '../lib/transport.js'
import { useLang } from '../lib/i18n.jsx'

/** Searchable list of all lines, grouped by mode. */
export default function LinePicker({ lines, routes, onSelect }) {
  const { lang, t } = useLang()
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    // group lines by mode
    const byMode = new Map()
    for (const [routeId, line] of Object.entries(lines)) {
      const route = routes[routeId]
      if (!route) continue
      const mode = ROUTE_TYPE_TO_MODE[route.t] ?? 'other'
      const name = (route.ln || '').trim().toLowerCase()
      const num = (route.n || '').toLowerCase()
      if (q && !num.includes(q) && !name.includes(q)) continue
      if (!byMode.has(mode)) byMode.set(mode, [])
      byMode.get(mode).push({ routeId, route, line })
    }
    const entries = [...byMode.entries()].map(([mode, items]) => ({
      mode,
      items: items.sort((a, b) => (Number(a.route.n) || 1e9) - (Number(b.route.n) || 1e9) || a.routeId.localeCompare(b.routeId)),
    }))
    // modes with lines first, MODES key order preserved
    entries.sort((a, b) => (Object.keys(MODES).indexOf(a.mode) ?? 99) - (Object.keys(MODES).indexOf(b.mode) ?? 99))
    return entries
  }, [query, lines, routes])

  return (
    <div className="line-picker">
      <div className="board-header">
        <h2>{t('pickerTitle')}</h2>
      </div>
      <input
        className="picker-search"
        aria-label={t('pickerSearch')}
        placeholder={t('pickerSearch')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <div className="picker-groups">
        {groups.map(({ mode, items }) => (
          <div key={mode} className="picker-group">
            <div className="picker-group-title">
              <span className="dot" style={{ background: MODES[mode]?.color }} />
              {MODES[mode]?.label ?? mode} · {items.length}
            </div>
            {items.map(({ routeId, route }) => (
              <button key={routeId} className="picker-row" onClick={() => onSelect(routeId)}>
                <span className="line-badge" style={{ background: route.c ? `#${route.c}` : MODES[mode]?.color }}>
                  {route.n || routeId}
                </span>
                <span className="picker-row-name" title={route.ln}>
                  {route.ln?.trim() || routeId}
                </span>
              </button>
            ))}
          </div>
        ))}
        {groups.length === 0 && <p className="board-empty">{t('pickerNoMatch')}</p>}
      </div>
    </div>
  )
}
