/**
 * fetch-toplo.mjs — heating outages for Sofia from Toplofikatsia Sofia
 * (toplo.bg/accidents-and-maintenance — server-rendered HTML per district).
 *
 * Parses district sections (h2) and the text that follows each, into
 * public/data/outages-toplo.json.
 *
 * Usage: node scripts/fetch-toplo.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises'

const URL_ = 'https://toplo.bg/accidents-and-maintenance'
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

  // district sections = h2 headings + the content that follows
  const sections = []
  const re = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi
  const marks = []
  let m
  while ((m = re.exec(html))) marks.push({ pos: m.index, title: decodeEntities(stripTags(m[1])).trim() })

  for (let i = 0; i < marks.length; i++) {
    const next = marks[i + 1]?.pos ?? html.length
    const chunk = html.slice(marks[i].pos, next)
    const text = stripTags(chunk.replace(re, ' ')).replace(/\s+/g, ' ').trim()
    if (text) sections.push({ title: marks[i].title, text })
  }

  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(
    new URL('outages-toplo.json', OUT_DIR),
    JSON.stringify({
      generated_at: new Date().toISOString(),
      source: 'Топлофикация София ЕАД (toplo.bg)',
      sections,
    }),
  )
  console.log(`outages-toplo.json: ${sections.length} sections`)
  sections.forEach((s) => console.log(`  - ${s.title} (${s.text.length} chars)`))
}

function stripTags(html) {
  return decodeEntities(
    html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
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
