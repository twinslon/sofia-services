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

- **Static network** — the official [Sofia Traffic GTFS feed](https://gtfs.sofiatraffic.bg/api/v1/static) (routes, trips, line shapes) is downloaded and simplified by `scripts/prepare-data.mjs` into small JSON files under `public/data/`.
- **Live vehicles** — the browser polls the official [GTFS-Realtime vehicle positions feed](https://gtfs.sofiatraffic.bg/api/v1/vehicle-positions) every 10 s, decodes the protobuf in-page, and matches vehicles to lines via the static data.
- **Map** — rendered with [MapLibre GL](https://maplibre.org/) on [OpenFreeMap](https://openfreemap.org) free vector tiles (dark style). No API keys needed.

| Endpoint | Purpose |
| --- | --- |
| `https://gtfs.sofiatraffic.bg/api/v1/static` | GTFS zip (routes, stops, schedules, shapes), refreshed daily |
| `https://gtfs.sofiatraffic.bg/api/v1/vehicle-positions` | Real-time vehicle positions (protobuf) |
| `https://gtfs.sofiatraffic.bg/api/v1/trip-updates` | Real-time arrival predictions (protobuf) — unused yet |
| `https://gtfs.sofiatraffic.bg/api/v1/alerts` | Service alerts (protobuf) — unused yet |

## Data license & attribution

Transport data © **Center for Urban Mobility / Център за градска мобилност (Sofia Traffic)**, licensed [CC-BY-4.0](https://www.sofia.bg/web/guest/transport-data). Attribution is embedded in the app UI.
Basemap © OpenStreetMap contributors, © CARTO.

## Roadmap

- [x] Live vehicle map with mode filtering
- [x] GitHub Pages deployment (Actions; daily cron rebuild refreshes GTFS extracts)
- [ ] Arrivals board per stop (trip-updates feed)
- [ ] Service alerts layer
- [ ] Line explorer with timetables
- [ ] More city services: air quality, bike parking, paid parking zones
