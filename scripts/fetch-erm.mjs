/**
 * fetch-erm.mjs — electricity outage status for Sofia from ERM Zapad
 * (info.ermzapad.bg/webint/vok/avplan.php — "Справка аварии и планирани
 * ремонти", server-rendered HTML listing affected municipalities per oblast).
 *
 * Bakes the Sofia-grad (Област София-град) section: affected municipalities
 * with planned/unplanned classification where determinable.
 *
 * Usage: node scripts/fetch-erm.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises'

const URL_ = 'https://info.ermzapad.bg/webint/vok/avplan.php'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/156.0 Safari/537.36'
const OUT_DIR = new URL('../public/data/', import.meta.url)

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

async function main() {
  const res = await fetch(URL_, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  let html = await res.text()
  html = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')

  // Sofia-grad section: from its oblast heading to the next oblast heading
  const start = html.search(/Област София-град/)
  if (start === -1) throw new Error('Sofia-grad section not found in avplan page')
  const nextOblast = html.slice(start + 10).search(/Област /)
  const section = html.slice(start, nextOblast === -1 ? undefined : start + 10 + nextOblast)

  const plain = decodeEntities(stripTags(section).replace(/\s+/g, ' '))

  // municipalities are rendered as "община NAME" / "кв." entries
  const municipalities = [...plain.matchAll(/община\s+([А-ЯA-Z][^\n,.:;—-]*)/g)].map((m2) =>
    m2[1].replace(/\s+Карта.*$/i, '').trim(),
  )
  const affected = [...new Set(municipalities)]

  const planned = /\bпланиран/i.test(plain)
  const unplanned = /\bнепланиран|авари/i.test(plain)

  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(
    new URL('outages-erm.json', OUT_DIR),
    JSON.stringify({
      generated_at: new Date().toISOString(),
      source: 'ЕРМ Запад ЕАД (info.ermzapad.bg/webint/vok/avplan.php)',
      oblast: 'Област София-град',
      municipalities: affected,
      planned,
      unplanned,
      raw_excerpt: plain.slice(0, 1200),
    }),
  )
  console.log(
    `outages-erm.json: Sofia-grad — municipalities affected: ${affected.length ? affected.join(', ') : '(none listed)'}`,
  )
}

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Decode HTML entities (incl. numeric &#x427; form) produced by the CMS. */
function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}
