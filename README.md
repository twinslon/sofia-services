# Sofia Services

Listing & visualizing city services in Sofia, Bulgaria — **starting with live public transport**.

**Live: https://twinslon.github.io/sofia-services/**

An interactive map showing the public transport network (lines, routes) and **vehicles moving in real time** — buses, trams, trolleybuses and the metro.

## Quick start

```bash
npm install
npm run prepare-data   # download official GTFS + build slim JSON extracts (~30s)
npm run dev            # http://localhost:5173
```

## How it works

- **Static network** — the official [Sofia Traffic GTFS feed](https://gtfs.sofiatraffic.bg/api/v1/static) (routes, trips, stops, line shapes) is downloaded by `scripts/prepare-data.mjs` into slim JSON extracts under `public/data/`: shapes are simplified (~80% fewer points), stops are deduplicated (dead stops dropped, same-name clusters within 75 m merged into one board).
- **Live feeds** — the browser polls the official GTFS-Realtime protobuf feeds and decodes them in-page: vehicle positions + trip updates every 10 s, service alerts every 60 s.
- **Map** — rendered with [MapLibre GL](https://maplibre.org/) on [OpenFreeMap](https://openfreemap.org) free vector tiles (light `positron` style). No API keys needed.

| Endpoint | Purpose |
| --- | --- |
| `https://gtfs.sofiatraffic.bg/api/v1/static` | GTFS zip (routes, stops, schedules, shapes), refreshed daily |
| `https://gtfs.sofiatraffic.bg/api/v1/vehicle-positions` | Real-time vehicle positions (protobuf) |
| `https://gtfs.sofiatraffic.bg/api/v1/trip-updates` | Real-time arrival predictions (protobuf) — arrivals boards, vehicle next-stops |
| `https://gtfs.sofiatraffic.bg/api/v1/alerts` | Service alerts (protobuf) — bell, panel, amber route highlights |

## Testing

```bash
npm test          # Playwright e2e + data-integrity suite (system Chrome, headless)
npm test:headed   # watch it run
npm test:report   # HTML report of the last run
```

The suite covers the live feed (decode, line matching, re-poll), map rendering (pixel-agnostic assertions via MapLibre's `queryRenderedFeatures` — works headless with software WebGL), mode filtering, and integrity of the prepared GTFS extracts. CI runs it on every PR and as a gate before each Pages deploy.

## Debugging with Chrome DevTools MCP

An `opencode.json` in the repo registers the [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) server (headless Chrome, usage stats disabled) for OpenCode sessions started inside this directory — console/network inspection, performance traces, and script evaluation against the running app.

## Data license & attribution

Transport data © **Center for Urban Mobility / Център за градска мобилност (Sofia Traffic)**, licensed [CC-BY-4.0](https://www.sofia.bg/web/guest/transport-data). Attribution is embedded in the app UI.
Basemap © OpenStreetMap contributors, tiles by [OpenFreeMap](https://openfreemap.org).

## Roadmap

### Shipped

- [x] Live vehicle map with mode filtering (metro / tram / trolley / bus)
- [x] Arrivals boards per stop — search by name or code, or click a stop dot on the map
- [x] Vehicle popups with line, headsign and next stops
- [x] Service alerts — bell + panel, affected lines highlighted amber on the map
- [x] Stop deduplication (dead stops dropped, directional pairs merged, alias-resolved RT lookups)
- [x] Live-coverage fading — stops without real-time predictions shrink to faint dots each poll
- [x] Light theme (OpenFreeMap positron + matching UI)
- [x] GitHub Pages deployment — CI test gate, daily cron rebuild refreshes GTFS extracts
- [x] Mobile ergonomics — bottom-sheet panels, compact header, touch targets
- [x] Smooth vehicle movement — positions tweened between polls (snap on GPS jumps)
- [x] E2E + data-integrity test suite (Playwright, 23 tests) and Chrome DevTools MCP debugging

### Next up

- [ ] Air quality layer — first non-transit city service: official monitoring stations on the map (needs data-source research: EEA Bulgaria / open data portal)
- [ ] bg/en UI toggle (GTFS translations.txt already carries both languages)
- [ ] Line explorer v2 — opt-in entry point (e.g. a line picker in the header) instead of map clicks, which misfired when aiming at vehicles

### Later

- [ ] City bike parking and paid parking zones (opendata.government.bg)
- [ ] Bundle code-splitting (maplibre + protobuf dominate the 380 kB gzipped JS)
- [ ] Static full-day timetables (calendar_dates) — live departures cover the current need
