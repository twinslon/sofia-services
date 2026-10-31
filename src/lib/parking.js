/**
 * Parking mode helpers: OSM-derived bike/car/EV layers.
 * Data baked daily by scripts/fetch-parking.mjs (Overpass API, ODbL).
 */

export const PARKING_LAYERS = [
  { key: 'bike', feedType: 'bike', color: '#2563eb', label: 'Bike parking', bg: 'Велопаркинги' },
  { key: 'car', feedType: 'car', color: '#7c3aed', label: 'Car parks', bg: 'Паркинги' },
  { key: 'ev', feedType: 'ev', color: '#16a34a', label: 'EV charging', bg: 'Е-зарядни станции' },
]

/** GeoJSON for the enabled parking layers. */
export function buildParkingFC(parkingData, enabled) {
  const enabledSet = enabled instanceof Set ? enabled : new Set(enabled)
  const features = (parkingData?.features ?? [])
    .filter((f) => enabledSet.has(f.type))
    .map((f) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [f.lon, f.lat] },
      properties: {
        id: f.id,
        type: f.type,
        name: f.name ?? '',
        capacity: f.capacity ?? '',
        capacityDisabled: f.capacityDisabled ?? '',
        access: f.access ?? '',
        fee: f.fee ?? '',
        operator: f.operator ?? '',
        kind: f.kind ?? '',
        sockets: f.sockets ?? null,
        charge: f.charge ?? '',
      },
    }))
  return { type: 'FeatureCollection', features }
}

/** Detail rows for the station popup (localized labels). */
export function parkingRows(props, lang) {
  const rows = []
  const push = (label, value) => {
    if (value !== '' && value != null) rows.push({ label, value: String(value) })
  }
  if (lang === 'bg') {
    push('Капацитет', props.capacity)
    push('Места за инвалиди', props.capacityDisabled)
    push('Достъп', props.access)
    push('Такса', props.fee)
    push('Оператор', props.operator)
    push('Тип', props.kind)
    push('Токоприемници', props.sockets)
    push('Заряд', props.charge)
  } else {
    push('Capacity', props.capacity)
    push('Disabled spots', props.capacityDisabled)
    push('Access', props.access)
    push('Fee', props.fee)
    push('Operator', props.operator)
    push('Type', props.kind)
    push('Connectors', props.sockets)
    push('Charge', props.charge)
  }
  return rows
}
