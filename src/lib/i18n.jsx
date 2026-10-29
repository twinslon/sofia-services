/**
 * Minimal i18n: dictionary + React context. No dependencies.
 * UI strings only — data (stop names, headsigns) stays as published.
 */

import { createContext, useContext, useState } from 'react'

export const LANGS = [
  { code: 'en', label: 'EN' },
  { code: 'bg', label: 'БГ' },
]

const STRINGS = {
  en: {
    transportTab: 'Transport',
    airTab: 'Air',
    taglineTransport: '{n} lines · live city services, starting with public transport',
    taglineLoading: 'Loading network data …',
    taglineAir: 'Official air quality monitoring · EEA',
    filterAll: 'All',
    filterMetro: 'Metro',
    filterTram: 'Trams',
    filterTrolley: 'Trolleybuses',
    filterBus: 'Buses',
    searchPlaceholder: 'Search stop…',
    bellAria: 'Service alerts',
    statusConnecting: 'Connecting to live feed …',
    statusVehicles: '{n} vehicles · updated {time}',
    statusFeedError: 'Feed error: {msg}',
    airStatusUpdated: 'Air quality · updated {time} · hourly',
    airStatusLoading: 'Loading air quality …',
    legendWorst: '{p} · worst now: {level}',
    legendCitizen: 'citizen sensor (indicative)',
    legendOfficial: 'official: {time}',
    boardNoArrivals: 'No upcoming arrivals in the live feed right now.',
    boardFooter: 'Live predictions · Center for Urban Mobility',
    aqNoReadings: 'No current readings.',
    aqFooter: 'EEA official monitoring · hourly',
    communityTitle: 'Citizen sensor #{id}',
    communityIndicative: 'indicative',
    minAgo: '{n} min ago',
    communityFooter: 'Sensor.Community · low-cost sensor',
    alertsTitle: 'Service alerts',
    alertsNone: 'No active alerts right now.',
    networkWide: 'Network-wide',
    attributionData: 'Data: Center for Urban Mobility (Sofia Traffic)',
    attributionStations: 'Stations: EEA (official)',
    attributionCommunity: 'Sensor.Community citizen sensors (CC BY-SA)',
  },
  bg: {
    transportTab: 'Транспорт',
    airTab: 'Въздух',
    taglineTransport: '{n} линии · живи градски услуги, първата — общественият транспорт',
    taglineLoading: 'Зареждане на данни …',
    taglineAir: 'Официален мониторинг на качеството на въздуха · ИАОС',
    filterAll: 'Всички',
    filterMetro: 'Метро',
    filterTram: 'Трамваи',
    filterTrolley: 'Тролейбуси',
    filterBus: 'Автобуси',
    searchPlaceholder: 'Търси спирка…',
    bellAria: 'Сигнали за движението',
    statusConnecting: 'Свързване с живите данни …',
    statusVehicles: '{n} превозни средства · обновено {time}',
    statusFeedError: 'Грешка в данните: {msg}',
    airStatusUpdated: 'Качество на въздуха · обновено {time} · на всеки час',
    airStatusLoading: 'Зареждане на качеството на въздуха …',
    legendWorst: '{p} · най-лошо сега: {level}',
    legendCitizen: 'граждански сензор (индикативен)',
    legendOfficial: 'официални: {time}',
    boardNoArrivals: 'Няма предстоящи пристигания в живите данни в момента.',
    boardFooter: 'Живи прогнози · Център за градска мобилност',
    aqNoReadings: 'Няма текущи измервания.',
    aqFooter: 'ИАОС официален мониторинг · на всеки час',
    communityTitle: 'Граждански сензор №{id}',
    communityIndicative: 'индикативно',
    minAgo: 'преди {n} мин',
    communityFooter: 'Sensor.Community · нискобюджетен сензор',
    alertsTitle: 'Сигнали',
    alertsNone: 'Няма активни сигнали в момента.',
    networkWide: 'За цялата мрежа',
    attributionData: 'Данни: Център за градска мобилност',
    attributionStations: 'Станции: ИАОС (официални)',
    attributionCommunity: 'Граждански сензори от Sensor.Community (CC BY-SA)',
  },
}

export function translate(lang, key, vars) {
  let s = STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  }
  return s
}

export function detectLang() {
  try {
    const saved = localStorage.getItem('sofia-lang')
    if (saved === 'en' || saved === 'bg') return saved
  } catch {
    /* storage unavailable */
  }
  return (navigator.language ?? 'en').toLowerCase().startsWith('bg') ? 'bg' : 'en'
}

const LangContext = createContext(null)

export function LangProvider({ children }) {
  const [lang, setLang] = useState(detectLang)
  const value = {
    lang,
    setLang: (l) => {
      try {
        localStorage.setItem('sofia-lang', l)
      } catch {
        /* ignore */
      }
      setLang(l)
    },
    t: (key, vars) => translate(lang, key, vars),
  }
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

export const useLang = () => useContext(LangContext)
