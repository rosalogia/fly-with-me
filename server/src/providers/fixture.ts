import { DateTime } from 'luxon'
import { airportTz } from '../airports.js'
import type { FlightProvider, ProviderOffer, ProviderSegment, SearchParams, SliceSpec } from './types.js'

/**
 * Deterministic synthetic provider for development and tests. Same params always
 * produce the same offers. Shapes are realistic enough to exercise the whole
 * pipeline: late-evening transpacific trunks reachable after a 17:00 home
 * departure, a 2-segment return trunk via PVG, and some origin/trunk pairs that
 * are unreachable same-day (producing incomplete options for split-ticket tests).
 */

function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface OutTrunk {
  carrier: string
  num: string
  gw: string
  depH: number
  durMin: number
}

const OUT_TRUNKS: OutTrunk[] = [
  { carrier: 'CA', num: '988', gw: 'LAX', depH: 23.8, durMin: 780 },
  { carrier: 'CA', num: '986', gw: 'SFO', depH: 23.0, durMin: 760 },
  { carrier: 'UA', num: '888', gw: 'SFO', depH: 22.5, durMin: 770 },
  { carrier: 'HU', num: '7962', gw: 'SEA', depH: 21.5, durMin: 740 },
  { carrier: 'CA', num: '982', gw: 'JFK', depH: 20.9, durMin: 830 },
  { carrier: 'MU', num: '588', gw: 'JFK', depH: 22.2, durMin: 850 },
]

interface RetTrunk {
  carrier: string
  num: string
  gw: string
  depH: number
  durMin: number
  /** Optional intra-China feeder before the crossing (2-segment trunk). */
  via?: { airport: string; carrier: string; num: string; depH: number; durMin: number }
}

const RET_TRUNKS: RetTrunk[] = [
  { carrier: 'CA', num: '983', gw: 'JFK', depH: 13.0, durMin: 820 },
  { carrier: 'HU', num: '7961', gw: 'SEA', depH: 11.5, durMin: 700 },
  { carrier: 'CA', num: '429', gw: 'LAX', depH: 15.0, durMin: 750 },
  {
    carrier: 'MU', num: '587', gw: 'JFK', depH: 12.5, durMin: 840,
    via: { airport: 'PVG', carrier: 'MU', num: '5402', depH: 7.5, durMin: 195 },
  },
  {
    carrier: 'MU', num: '577', gw: 'LAX', depH: 14.0, durMin: 720,
    via: { airport: 'PVG', carrier: 'MU', num: '5404', depH: 8.8, durMin: 195 },
  },
]

const DOMESTIC_CARRIERS = ['AA', 'DL', 'UA', 'AS', 'B6']

/** Rough US domestic durations in minutes; symmetric; default 240. */
const DOMESTIC_DUR: Record<string, number> = {
  'MIA-LAX': 350, 'MIA-SFO': 370, 'MIA-SEA': 400, 'MIA-JFK': 190,
  'WAS-LAX': 324, 'WAS-SFO': 340, 'WAS-SEA': 330, 'WAS-JFK': 80,
  'SEA-LAX': 165, 'SEA-SFO': 130, 'SEA-JFK': 315,
  'IAD-LAX': 324, 'IAD-SFO': 340, 'IAD-SEA': 330, 'IAD-JFK': 80,
}

function domesticDur(a: string, b: string): number {
  return DOMESTIC_DUR[`${a}-${b}`] ?? DOMESTIC_DUR[`${b}-${a}`] ?? 240
}

function tzOf(iata: string): string {
  return airportTz(iata) ?? 'America/New_York'
}

function fmt(dt: DateTime): string {
  return dt.toFormat("yyyy-MM-dd'T'HH:mm:ss")
}

function atLocal(date: string, decimalHour: number, tz: string): DateTime {
  const h = Math.floor(decimalHour)
  const m = Math.round((decimalHour - h) * 60)
  return DateTime.fromISO(`${date}T00:00:00`, { zone: tz }).plus({ hours: h, minutes: m })
}

function seg(
  carrier: string,
  num: string,
  origin: string,
  destination: string,
  dep: DateTime,
  durMin: number,
): { s: ProviderSegment; arr: DateTime } {
  const arr = dep.plus({ minutes: durMin }).setZone(tzOf(destination))
  return {
    s: {
      carrier,
      flightNumber: num,
      operatingCarrier: carrier,
      origin,
      destination,
      departsLocal: fmt(dep),
      arrivesLocal: fmt(arr),
      originTz: tzOf(origin),
      destTz: tzOf(destination),
      durationMin: durMin,
      aircraft: null,
    },
    arr,
  }
}

function timeOk(dep: DateTime, slice: SliceSpec): boolean {
  if (fmt(dep).slice(0, 10) !== slice.departureDate) return false
  if (slice.departAfterLocal && fmt(dep).slice(11, 16) < slice.departAfterLocal) return false
  return true
}

const isUS = (iata: string) => tzOf(iata).startsWith('America/') || tzOf(iata) === 'Pacific/Honolulu'
const isAsia = (iata: string) => tzOf(iata).startsWith('Asia/')

/** Build candidate segment-lists for one slice. Returns [] when nothing plausible fits. */
function buildSliceOptions(slice: SliceSpec, rand: () => number): ProviderSegment[][] {
  const { origin, destination, departureDate } = slice

  // US -> Asia: feeder (if needed) + outbound trunk.
  if (isUS(origin) && isAsia(destination)) {
    const out: ProviderSegment[][] = []
    for (const t of OUT_TRUNKS) {
      // Seeded dropout so some trunks are simply not offered from some origins/dates.
      if (fnv1a(`${origin}|${t.carrier}${t.num}|${departureDate}`) % 5 === 0 && origin !== t.gw) continue
      const trunkDep = atLocal(departureDate, t.depH, tzOf(t.gw))
      const trunk = seg(t.carrier, t.num, t.gw, destination, trunkDep, t.durMin)
      if (origin === t.gw) {
        if (timeOk(trunkDep, slice)) out.push([trunk.s])
        continue
      }
      const dur = domesticDur(origin, t.gw)
      const buffer = 100 + Math.floor(rand() * 60)
      const feederDep = trunkDep.minus({ minutes: dur + buffer }).setZone(tzOf(origin))
      if (!timeOk(feederDep, slice)) continue
      const carrier = DOMESTIC_CARRIERS[fnv1a(`${origin}${t.gw}`) % DOMESTIC_CARRIERS.length]!
      const num = String(1000 + (fnv1a(`${origin}${t.gw}${t.num}`) % 899))
      const feeder = seg(carrier, num, origin, t.gw, feederDep, dur)
      out.push([feeder.s, trunk.s])
    }
    return out
  }

  // Asia -> US: (optional intra-China feeder) + crossing + domestic leg home (if needed).
  if (isAsia(origin) && isUS(destination)) {
    const out: ProviderSegment[][] = []
    for (const t of RET_TRUNKS) {
      if (fnv1a(`${origin}|ret|${t.carrier}${t.num}|${departureDate}`) % 6 === 0) continue
      const segs: ProviderSegment[] = []
      let crossingOrigin = origin
      let crossingDate = departureDate
      if (t.via) {
        const feederDep = atLocal(departureDate, t.via.depH, tzOf(origin))
        if (!timeOk(feederDep, slice)) continue
        const feeder = seg(t.via.carrier, t.via.num, origin, t.via.airport, feederDep, t.via.durMin)
        segs.push(feeder.s)
        crossingOrigin = t.via.airport
        crossingDate = fmt(feeder.arr).slice(0, 10)
      }
      const crossDep = atLocal(crossingDate, t.depH, tzOf(crossingOrigin))
      if (!t.via && !timeOk(crossDep, slice)) continue
      const cross = seg(t.carrier, t.num, crossingOrigin, t.gw, crossDep, t.durMin)
      segs.push(cross.s)
      if (destination !== t.gw) {
        const dur = domesticDur(t.gw, destination)
        const homeDep = cross.arr.plus({ minutes: 120 + Math.floor(rand() * 90) })
        const home = seg(
          DOMESTIC_CARRIERS[fnv1a(`${t.gw}${destination}`) % DOMESTIC_CARRIERS.length]!,
          String(2000 + (fnv1a(`${t.gw}${destination}${t.num}`) % 899)),
          t.gw,
          destination,
          homeDep,
          dur,
        )
        segs.push(home.s)
      }
      out.push(segs)
    }
    return out
  }

  // Domestic positioning: a few nonstops spread through the day.
  const out: ProviderSegment[][] = []
  const dur = domesticDur(origin, destination)
  for (const depH of [7.2, 10.5, 13.0, 17.5, 19.2]) {
    const dep = atLocal(departureDate, depH, tzOf(origin))
    if (!timeOk(dep, slice)) continue
    const carrier = DOMESTIC_CARRIERS[fnv1a(`pos${origin}${destination}${depH}`) % DOMESTIC_CARRIERS.length]!
    const num = String(3000 + (fnv1a(`${origin}${destination}${depH}`) % 899))
    out.push([seg(carrier, num, origin, destination, dep, dur).s])
  }
  return out
}

function priceCents(segLists: ProviderSegment[][], travelers: number, rand: () => number): number {
  const totalDur = segLists.flat().reduce((s, x) => s + (x.durationMin ?? 0), 0)
  const crossings = segLists.flat().filter((x) => isUS(x.origin) !== isUS(x.destination)).length
  const base = crossings > 0 ? 52000 * crossings : 9000
  const perPerson = Math.round((base + totalDur * 22 + rand() * (crossings > 0 ? 30000 : 9000)) / 100) * 100
  return perPerson * travelers
}

export function fixtureProvider(): FlightProvider {
  return {
    name: 'fixture',
    async search(params: SearchParams): Promise<ProviderOffer[]> {
      const rand = mulberry32(fnv1a(JSON.stringify(params)))
      const perSlice = params.slices.map((sl) => buildSliceOptions(sl, rand))
      if (perSlice.some((opts) => opts.length === 0)) return []

      // Cartesian combos across slices, capped.
      let combos: ProviderSegment[][][] = [[]]
      for (const opts of perSlice) {
        combos = combos.flatMap((c) => opts.map((o) => [...c, o]))
        if (combos.length > 40) combos = combos.slice(0, 40)
      }

      return combos.map((slices, i) => ({
        offerId: `fixture_${fnv1a(JSON.stringify(params))}_${i}`,
        totalAmountCents: priceCents(slices, params.travelers, rand),
        currency: 'USD',
        slices,
      }))
    },
  }
}
