import { test, expect } from '@playwright/test'
import { aqiBand, aqiBandScale, buildAqFeatures, buildCommunityFeatures } from '../src/lib/aq.js'

test.describe('air quality index helpers', () => {
  test('bands map values to the right level', () => {
    // PM10 breakpoints: 20 fair / 40 moderate / 50 poor / 100 very-poor / 150 extremely-poor
    expect(aqiBand('PM10', 5)?.level).toBe('good')
    expect(aqiBand('PM10', 35)?.level).toBe('fair')
    expect(aqiBand('PM10', 45)?.level).toBe('moderate')
    expect(aqiBand('PM10', 80)?.level).toBe('poor')
    expect(aqiBand('PM10', 120)?.level).toBe('very-poor')
    expect(aqiBand('PM10', 500)?.level).toBe('extremely-poor')
    // PM2.5 has its own scale: 10/20/25/50/75
    expect(aqiBand('PM2.5', 8)?.level).toBe('good')
    expect(aqiBand('PM2.5', 30)?.level).toBe('poor')
    // O3: 50/100/130/240/380
    expect(aqiBand('O3', 120)?.level).toBe('moderate')
  })

  test('band scale is complete and ordered good -> extremely poor', () => {
    const scale = aqiBandScale()
    expect(scale.map((b) => b.level)).toEqual([
      'good', 'fair', 'moderate', 'poor', 'very-poor', 'extremely-poor',
    ])
    expect(scale.every((b) => b.color && b.label)).toBe(true)
  })

  test('community sensors: only for PM pollutants, outliers rejected', () => {
    const sc = {
      sensors: [
        { id: 1, type: 'SDS011', lat: 42.7, lon: 23.3, timestamp: '2026-10-28 18:52:28', P1: 35, P2: 20 },
        { id: 2, type: 'SDS011', lat: 42.71, lon: 23.31, timestamp: '2026-10-28 18:52:00', P1: 2266, P2: 1800 }, // broken
        { id: 3, type: 'BME280', lat: 42.72, lon: 23.32, timestamp: '2026-10-28 18:52:00' }, // no PM
      ],
    }
    const pm10 = buildCommunityFeatures(sc, 'PM10')
    expect(pm10.features.length).toBe(1)
    expect(pm10.features[0].properties.level).toBe('fair') // 35 µg/m³
    // NO2 has no community coverage
    expect(buildCommunityFeatures(sc, 'NO2')).toBeNull()
    // PM2.5 uses the P2 value
    const pm25 = buildCommunityFeatures(sc, 'PM2_5')
    expect(pm25.features[0].properties.value).toBe(20)
  })

  test('buildAqFeatures colors stations by the selected pollutant', () => {
    const aqData = {
      stations: [
        { code: 'BG0052A', name: 'Druzhba', lat: 42.65, lon: 23.4, area: 'urban', values: { PM10: { v: 80, t: 'x' }, NO2: { v: 10, t: 'x' } } },
      ],
    }
    const fc = buildAqFeatures(aqData, 'PM10')
    const f = fc.features[0]
    expect(f.properties.level).toBe('poor') // 80 µg/m³ PM10 = poor
    expect(f.properties.color).toBe('#ff5050')
    const fc2 = buildAqFeatures(aqData, 'NO2')
    expect(fc2.features[0].properties.level).toBe('good') // 10 µg/m³ NO2 = good
    expect(JSON.parse(fc2.features[0].properties.values).NO2.v).toBe(10)
  })
})
