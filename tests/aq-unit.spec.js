import { test, expect } from '@playwright/test'
import { aqiBand, aqiBandScale, buildAqFeatures } from '../src/lib/aq.js'

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
