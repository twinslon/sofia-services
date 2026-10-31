# Sofia Services

Listing & visualizing city services in Sofia, Bulgaria — **starting with live public transport**.

**Live: https://twinslon.github.io/sofia-services/**

https://github.com/twinslon/sofia-services/raw/main/docs/demo.mp4

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
- [x] **Air quality layer** — first non-transit service: official EEA monitoring stations, pollutant selector (PM10/PM2.5/NO₂/O₃/SO₂/CO), EU index colors, station popups; hourly refresh
- [x] Citizen-sensor layer — 327 Sensor.Community PM sensors, hourly bake, outliers rejected
- [x] Air quality v2 — 48h sparkline trend per pollutant in station popups
- [x] Light theme (OpenFreeMap positron + matching UI)
- [x] GitHub Pages deployment — CI test gate, daily cron rebuild refreshes GTFS extracts
- [x] Mobile ergonomics — bottom-sheet panels, compact header, touch targets
- [x] Smooth vehicle movement — positions tweened between polls (snap on GPS jumps)
- [x] bg/en UI toggle — Bulgarian + English chrome, auto-detected and persisted
- [x] **Parking mode** — third switcher entry: 6,236 OSM spots (bike parking, car parks, 256 EV charging), multi-select layer chips, detail popups, daily bake
- [x] **Line explorer v2** — opt-in ☰ Lines picker in the header: both directions, ordered stops, live next departures, route highlight + fit-to-view
- [x] E2E + data-integrity test suite (Playwright, 43 tests) and Chrome DevTools MCP debugging

### Next up

- [ ] Gather real user feedback before further expansion

### Later

- [ ] **Real mobile app** — preferred path: Capacitor wrap of this web app (reuses everything; adds native GPS, push notifications for alerts, app-store presence). Cheaper intermediate: PWA install support (manifest + service worker)
- [ ] Street-level parking spaces (31,705 official spots, Sept 2020 survey) — likely redundant with OSM layer; data partly stale post-2026 zone expansion
- [ ] Paid zone polygons — **BLOCKED on official data**: municipal GeoJSON exists but is stale (2020 layout, missing the 2021 + Jan-2026 expansions; verified — the expanded kv. МАКЕДОНИЯ area is absent). Next step: request current geometry from ОП Транспорт / Столична община, or digitize from the ordinance street lists
- [ ] Bundle code-splitting — LOW priority: single-view map app, everything in the 382 kB gzipped bundle is on the critical path. Revisit only if heavy per-service modules appear. Bigger perf lever if ever needed: lazy-load GTFS extracts (~6 MB raw) by viewport
- [ ] Static full-day timetables (calendar_dates) — live departures cover the current need
