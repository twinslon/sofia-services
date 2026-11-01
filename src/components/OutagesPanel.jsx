import { useLang } from '../lib/i18n.jsx'
import { fmtRange } from '../lib/outages.js'

/** Outages panel: heating sections + electricity municipalities. */
export default function OutagesPanel({ toplo, erm, onClose }) {
  const { lang, t } = useLang()
  return (
    <div className="outages-panel">
      <div className="board-header">
        <h2>{t('outagesTitle')}</h2>
        <button className="board-close" aria-label="Close" onClick={onClose}>✕</button>
      </div>

      <section className="outages-section">
        <h3>{t('outagesHeating')}</h3>
        {(toplo?.sections ?? []).slice(0, 12).map((s, i) => (
          <div key={i} className="outage-item">
            <strong>{s.title}</strong>
            <p className="muted-sm">{s.text.slice(0, 240)}{s.text.length > 240 ? '…' : ''}</p>
          </div>
        ))}
        {(toplo?.sections ?? []).length === 0 && <p className="muted-sm">{t('outagesNone')}</p>}
      </section>

      <section className="outages-section">
        <h3>{t('outagesElectricity')}</h3>
        <div className="outage-item">
          <strong>{erm?.oblast ?? 'София-град'}</strong>
          <p className="muted-sm">
            {(erm?.municipalities ?? []).join(', ') || '—'} · {erm?.planned ? 'планирани' : ''} {erm?.unplanned ? 'непланирани' : ''} прекъсвания
          </p>
        </div>
      </section>

      <p className="muted-sm">{lang === 'bg' ? 'Данни: Топлофикация София · ЕРМ Запад' : 'Data: Toplofikatsia Sofia · ERM Zapad'}</p>
    </div>
  )
}
