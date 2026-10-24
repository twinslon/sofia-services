import { useMemo, useRef, useState } from 'react'

/** Search box with autocomplete over the static stop list. */
export default function StopSearch({ stops, onSelect }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const blurTimer = useRef(null)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    const code = q.replace(/^0+/, '')
    const scored = []
    for (const [stopId, s] of Object.entries(stops)) {
      const name = s.n.toLowerCase()
      let score = -1
      if (s.c && s.c.replace(/^0+/, '') === code) score = 0
      else if (name.startsWith(q)) score = 1
      else if (name.includes(q)) score = 2
      if (score >= 0) scored.push({ score, stopId, name: s.n, code: s.c })
    }
    scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    return scored.slice(0, 8)
  }, [query, stops])

  const pick = (r) => {
    setQuery(r.name)
    setOpen(false)
    onSelect(r.stopId)
  }

  return (
    <div className="stop-search">
      <input
        aria-label="Search stop"
        placeholder="Търси спирка / search stop…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 150)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) pick(results[0])
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && results.length > 0 && (
        <ul className="stop-results">
          {results.map((r) => (
            <li key={r.stopId}>
              <button onClick={() => pick(r)}>
                <span className="stop-name">{r.name}</span>
                {r.code && <span className="stop-code">{r.code}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
