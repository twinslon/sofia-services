/**
 * Privacy-friendly page analytics (GoatCounter, no cookies).
 *
 * Disabled until a site code is configured: create a free account at
 * https://www.goatcounter.com (non-commercial = free), then set
 * GOATCOUNTER_SITE below to your site code (e.g. 'sofia-services').
 * Empty string = no requests are made at all.
 */

const GOATCOUNTER_SITE = ''

export function initAnalytics() {
  if (!GOATCOUNTER_SITE) return
  if (document.querySelector('script[data-goatcounter]')) return
  const s = document.createElement('script')
  s.async = true
  s.src = 'https://gc.zgo.at/count.js'
  s.dataset.goatcounter = `https://${GOATCOUNTER_SITE}.goatcounter.com/count`
  document.head.appendChild(s)
}

/** Count an in-app "virtual page" (e.g. a service switch). */
export function trackPage(path, title) {
  if (!GOATCOUNTER_SITE || !window.goatcounter) return
  window.goatcounter.count({ path, title })
}
