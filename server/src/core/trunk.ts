import { airportTz } from '../airports.js'

export interface TrunkSeg {
  carrier: string
  flightNumber: string
  origin: string
  destination: string
  departsLocal: string
  arrivesLocal: string
  originTz: string | null
  destTz: string | null
}

export type Region = 'america' | 'asia' | 'other'

export function regionOfAirport(iata: string, tz?: string | null): Region {
  const zone = tz ?? airportTz(iata)
  if (!zone) return 'other'
  if (zone.startsWith('America/') || zone === 'Pacific/Honolulu') return 'america'
  if (zone.startsWith('Asia/')) return 'asia'
  return 'other'
}

/**
 * Outbound trunk = the suffix of the itinerary that everyone must share,
 * anchored at the first segment that ENTERS Asia from anywhere non-Asia.
 * Covers transpacific crossings (LAX->PEK, SEA->ICN) and via-Europe/-elsewhere
 * routings (IST->PEK); everything after the entry segment (Asia-side
 * connections) is part of the trunk. Null when the itinerary never enters Asia.
 * Known limitation: Middle-East hubs on Asia/* timezones (DXB, DOH) anchor the
 * trunk one segment early, which under-matches (drops) those combos rather than
 * grouping them wrongly.
 */
export function outboundTrunkSegs<T extends TrunkSeg>(segs: T[]): T[] | null {
  const i = segs.findIndex(
    (s) =>
      regionOfAirport(s.origin, s.originTz) !== 'asia' &&
      regionOfAirport(s.destination, s.destTz) === 'asia',
  )
  return i === -1 ? null : segs.slice(i)
}

/**
 * Return trunk = the prefix: the first segment out of the destination country
 * through the first segment that LEAVES Asia, inclusive.
 */
export function returnTrunkSegs<T extends TrunkSeg>(segs: T[]): T[] | null {
  const i = segs.findIndex(
    (s) =>
      regionOfAirport(s.origin, s.originTz) === 'asia' &&
      regionOfAirport(s.destination, s.destTz) !== 'asia',
  )
  return i === -1 ? null : segs.slice(0, i + 1)
}

/**
 * Canonical trunk identity: marketing carrier + flight number + local departure
 * date per segment. Codeshares are intentionally NOT merged.
 */
export function trunkKey(segs: TrunkSeg[]): string {
  return segs
    .map((s) => `${s.carrier}${s.flightNumber}|${s.departsLocal.slice(0, 10)}|${s.origin}-${s.destination}`)
    .join('>')
}

export interface ParsedTrunkKey {
  segments: { flight: string; date: string; origin: string; destination: string }[]
  /** First segment's origin (the US gateway for outbound keys, China departure for return keys). */
  firstOrigin: string
  /** Last segment's destination (China arrival for outbound keys, US gateway for return keys). */
  lastDestination: string
  firstDate: string
}

export function parseTrunkKey(key: string): ParsedTrunkKey {
  const segments = key.split('>').map((part) => {
    const [flight, date, route] = part.split('|')
    const [origin, destination] = (route ?? '').split('-')
    if (!flight || !date || !origin || !destination) throw new Error(`malformed trunk key: ${key}`)
    return { flight, date, origin, destination }
  })
  return {
    segments,
    firstOrigin: segments[0]!.origin,
    lastDestination: segments[segments.length - 1]!.destination,
    firstDate: segments[0]!.date,
  }
}
