import { createHash } from 'node:crypto'
import type {
  GroupOptionDto, OptionMetrics, PartyItineraryDto, SegmentDto, SplitTicketDto, TripConfig, TrunkLegSummary,
} from '@fwm/shared'
import { isUSAirport } from '../airports.js'
import type { DB } from '../db/db.js'
import { deriveDatePairs } from '../fetch/datePairs.js'
import { localHour, minutesBetween } from './time.js'
import { parseTrunkKey } from './trunk.js'

interface ItinRow {
  id: number
  party_id: string
  kind: string
  travelers: number
  total_cents: number
  currency: string
  per_person_cents: number
  dep_date: string
  ret_date: string
  outbound_trunk_key: string
  return_trunk_key: string
}

interface SegRow {
  leg: 'outbound' | 'return'
  pos: number
  carrier: string
  flight_number: string
  operating_carrier: string | null
  origin: string
  destination: string
  departs_local: string
  arrives_local: string
  origin_tz: string
  dest_tz: string
  duration_min: number | null
  aircraft: string | null
  is_trunk: number
}

export function optionId(outKey: string, retKey: string): string {
  return createHash('sha256').update(`${outKey}||${retKey}`).digest('hex').slice(0, 12)
}

function segToDto(r: SegRow): SegmentDto {
  return {
    leg: r.leg, pos: r.pos, carrier: r.carrier, flightNumber: r.flight_number,
    operatingCarrier: r.operating_carrier, origin: r.origin, destination: r.destination,
    departsLocal: r.departs_local, arrivesLocal: r.arrives_local,
    originTz: r.origin_tz, destTz: r.dest_tz, durationMin: r.duration_min,
    aircraft: r.aircraft, isTrunk: r.is_trunk === 1,
  }
}

export function loadSegments(db: DB, itineraryId: number): SegmentDto[] {
  const rows = db
    .prepare(`SELECT * FROM segments WHERE itinerary_id = ? ORDER BY leg DESC, pos ASC`)
    .all(itineraryId) as SegRow[]
  const segs = rows
    .map(segToDto)
    .sort((a, b) => (a.leg === b.leg ? a.pos - b.pos : a.leg === 'outbound' ? -1 : 1))
  for (let i = 1; i < segs.length; i++) {
    const prev = segs[i - 1]!
    const cur = segs[i]!
    if (prev.leg === cur.leg) {
      cur.layoverBeforeMin = minutesBetween(prev.arrivesLocal, prev.destTz, cur.departsLocal, cur.originTz)
    }
  }
  return segs
}

/** Piecewise-linear desirability curve over local hour [0,24] -> [0,1]. */
export function curve(points: [number, number][], h: number): number {
  if (h <= points[0]![0]) return points[0]![1]
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i - 1]!
    const [x2, y2] = points[i]!
    if (h <= x2) return y1 + ((h - x1) / (x2 - x1)) * (y2 - y1)
  }
  return points[points.length - 1]![1]
}

export const US_DEP_Q: [number, number][] = [[0, 0], [10, 0.1], [14, 0.5], [17, 1], [21, 1], [24, 0.5]]
export const CHINA_ARR_Q: [number, number][] = [[0, 0.1], [6, 0.3], [9, 1], [15, 1], [20, 0.6], [24, 0.2]]
export const CHINA_DEP_Q: [number, number][] = [[0, 0], [6, 0.3], [9, 1], [17, 1], [21, 0.4], [24, 0.1]]
export const HOME_ARR_Q: [number, number][] = [[0, 0], [6, 0.2], [12, 1], [22, 1], [24, 0.3]]

function trunkSummary(key: string, segs: SegmentDto[]): TrunkLegSummary {
  const first = segs[0]!
  const last = segs[segs.length - 1]!
  let layoverMin = 0
  for (let i = 1; i < segs.length; i++) {
    layoverMin += minutesBetween(
      segs[i - 1]!.arrivesLocal, segs[i - 1]!.destTz, segs[i]!.departsLocal, segs[i]!.originTz,
    )
  }
  return {
    key,
    segments: segs.map((s) => ({
      carrier: s.carrier, flightNumber: s.flightNumber,
      origin: s.origin, destination: s.destination, date: s.departsLocal.slice(0, 10),
    })),
    departsLocal: first.departsLocal,
    arrivesLocal: last.arrivesLocal,
    elapsedMin: minutesBetween(first.departsLocal, first.originTz, last.arrivesLocal, last.destTz),
    layovers: segs.length - 1,
  }
}

function layoverMinutes(segs: SegmentDto[]): number {
  let total = 0
  for (let i = 1; i < segs.length; i++) {
    total += minutesBetween(
      segs[i - 1]!.arrivesLocal, segs[i - 1]!.destTz, segs[i]!.departsLocal, segs[i]!.originTz,
    )
  }
  return total
}

export interface AssembleOpts {
  includeIncomplete?: boolean
  /** Attach full segment lists for every party (detail view). */
  withSegments?: boolean
  /** Only use itineraries fetched by this provider (avoids mixing synthetic and real data). */
  provider?: string
}

export function assembleOptions(db: DB, cfg: TripConfig, opts: AssembleOpts = {}): GroupOptionDto[] {
  const partyIds = cfg.parties.map((p) => p.id)
  const validPairs = new Set(deriveDatePairs(cfg).map((p) => `${p.depart}|${p.ret}`))

  const rows = db
    .prepare(
      `SELECT i.id, i.party_id, i.kind, i.travelers, i.total_cents, i.currency, i.per_person_cents,
              i.dep_date, i.ret_date, i.outbound_trunk_key, i.return_trunk_key
       FROM itineraries i
       JOIN searches s ON s.id = i.search_id
       WHERE i.kind = 'openjaw' AND i.outbound_trunk_key IS NOT NULL AND i.return_trunk_key IS NOT NULL
         AND (? IS NULL OR s.provider = ?)`,
    )
    .all(opts.provider ?? null, opts.provider ?? null) as ItinRow[]

  // Group by trunk pair; keep each party's cheapest itinerary.
  const groups = new Map<string, Map<string, ItinRow>>()
  for (const r of rows) {
    if (!partyIds.includes(r.party_id)) continue
    if (!validPairs.has(`${r.dep_date}|${r.ret_date}`)) continue
    const key = `${r.outbound_trunk_key}||${r.return_trunk_key}`
    let byParty = groups.get(key)
    if (!byParty) groups.set(key, (byParty = new Map()))
    const prev = byParty.get(r.party_id)
    if (!prev || r.total_cents < prev.total_cents) byParty.set(r.party_id, r)
  }

  const splitStmt = db.prepare(
    `SELECT * FROM split_tickets WHERE outbound_trunk_key = ? AND return_trunk_key = ?`,
  )
  const itinByIdStmt = db.prepare(`SELECT * FROM itineraries WHERE id = ?`)

  const options: GroupOptionDto[] = []
  for (const [key, byParty] of groups) {
    const [outKey, retKey] = key.split('||') as [string, string]
    const parsedOut = parseTrunkKey(outKey)
    const parsedRet = parseTrunkKey(retKey)
    const gatewayOut = parsedOut.firstOrigin
    const gatewayIn = parsedRet.lastDestination

    // Cached itineraries may be for a different direction/airport set than the
    // current config (e.g. after swapping into/out of China) — only show trunks
    // matching the configured endpoints.
    if (!cfg.intoChina.includes(parsedOut.lastDestination)) continue
    if (!cfg.outOfChina.includes(parsedRet.firstOrigin)) continue

    if (cfg.gatewayAllowlist && !(cfg.gatewayAllowlist.includes(gatewayOut) && cfg.gatewayAllowlist.includes(gatewayIn))) {
      continue
    }

    const present = partyIds.filter((p) => byParty.has(p))
    const missing = partyIds.filter((p) => !byParty.has(p))

    // Split-ticket coverage for missing parties.
    const splitRows = (splitStmt.all(outKey, retKey) as any[]).filter((s) =>
      missing.includes(s.party_id),
    )
    const splitParties = splitRows.map((s) => s.party_id as string)
    const stillMissing = missing.filter((p) => !splitParties.includes(p))
    const complete = missing.length === 0
    const priceable = stillMissing.length === 0

    if (!priceable && !opts.includeIncomplete) continue

    // Representative party itinerary carries the shared trunk segments.
    const repRow = byParty.get(present[0]!)!
    const repSegs = loadSegments(db, repRow.id)
    const outTrunkSegs = repSegs.filter((s) => s.leg === 'outbound' && s.isTrunk)
    const retTrunkSegs = repSegs.filter((s) => s.leg === 'return' && s.isTrunk)

    const partyDtos: PartyItineraryDto[] = present.map((p) => {
      const r = byParty.get(p)!
      return {
        partyId: p, itineraryId: r.id, kind: 'openjaw', travelers: r.travelers,
        totalCents: r.total_cents, perPersonCents: r.per_person_cents, currency: r.currency,
        ...(opts.withSegments ? { segments: loadSegments(db, r.id) } : {}),
      }
    })

    // A gateway wait beyond ~16h necessarily spans a night (a 12h daytime wait
    // doesn't); every further 24h is another night. Buffer-based, not
    // date-boundary, so a 23h wait starting just after midnight still counts.
    const nightsFromBuffer = (bufferMin: number) => Math.max(0, Math.ceil((bufferMin - 960) / 1440))

    const splitDtos: SplitTicketDto[] = splitRows.map((s) => {
      const componentIds = [s.pos_out_itin_id, s.trunk_itin_id, s.pos_back_itin_id] as number[]
      const party = cfg.parties.find((p) => p.id === s.party_id)!
      const overnightNights = nightsFromBuffer(s.buffer_out_min) + nightsFromBuffer(s.buffer_back_min)
      return {
        partyId: s.party_id,
        totalCents: s.total_cents,
        perPersonCents: Math.round(s.total_cents / party.travelers),
        currency: s.currency,
        bufferOutMin: s.buffer_out_min,
        bufferBackMin: s.buffer_back_min,
        overnightNights,
        flags: JSON.parse(s.flags_json),
        components: componentIds.map((cid) => {
          const it = itinByIdStmt.get(cid) as any
          return {
            partyId: s.party_id, itineraryId: it.id, kind: it.kind, travelers: it.travelers,
            totalCents: it.total_cents, perPersonCents: it.per_person_cents, currency: it.currency,
            ...(opts.withSegments ? { segments: loadSegments(db, it.id) } : {}),
          } satisfies PartyItineraryDto
        }),
      }
    })

    // Prices & metrics (only when every party is covered).
    let totalCents: number | null = null
    let perPersonMin: number | null = null
    let perPersonMax: number | null = null
    let metrics: OptionMetrics | null = null

    if (priceable) {
      const perPerson: number[] = [
        ...partyDtos.map((p) => p.perPersonCents),
        ...splitDtos.map((s) => s.perPersonCents),
      ]
      totalCents =
        partyDtos.reduce((s, p) => s + p.totalCents, 0) +
        splitDtos.reduce((s, x) => s + x.totalCents, 0)
      perPersonMin = Math.min(...perPerson)
      perPersonMax = Math.max(...perPerson)

      const outSummary = trunkSummary(outKey, outTrunkSegs)
      const retSummary = trunkSummary(retKey, retTrunkSegs)

      // Time-of-day quality: shared trunk times + per-party (single-ticket) home ends.
      const chinaArrQ = curve(CHINA_ARR_Q, localHour(outSummary.arrivesLocal))
      const chinaDepQ = curve(CHINA_DEP_Q, localHour(retSummary.departsLocal))
      const travelersOf = (p: string) => cfg.parties.find((x) => x.id === p)?.travelers ?? 1
      // Door-to-door minutes per party (traveler-weighted), including positioning
      // legs and gateway waits for split-ticket parties.
      let doorMinutesWeighted = 0
      let doorTravelers = 0
      const personal = present.map((p) => {
        const segs = p === present[0] ? repSegs : loadSegments(db, byParty.get(p)!.id)
        const outSegs = segs.filter((s) => s.leg === 'outbound')
        const retSegsAll = segs.filter((s) => s.leg === 'return')
        const outFirst = outSegs[0]!
        const outLast = outSegs[outSegs.length - 1]!
        const retFirst = retSegsAll[0]!
        const retLast = retSegsAll[retSegsAll.length - 1]!
        doorMinutesWeighted +=
          travelersOf(p) *
          (minutesBetween(outFirst.departsLocal, outFirst.originTz, outLast.arrivesLocal, outLast.destTz) +
            minutesBetween(retFirst.departsLocal, retFirst.originTz, retLast.arrivesLocal, retLast.destTz))
        doorTravelers += travelersOf(p)
        return (curve(US_DEP_Q, localHour(outFirst.departsLocal)) + curve(HOME_ARR_Q, localHour(retLast.arrivesLocal))) / 2
      })
      for (const s of splitRows) {
        const posOutSegs = loadSegments(db, s.pos_out_itin_id)
        const trunkSegs = loadSegments(db, s.trunk_itin_id)
        const posBackSegs = loadSegments(db, s.pos_back_itin_id)
        const dep = posOutSegs[0]!
        const trunkOutLast = trunkSegs.filter((x) => x.leg === 'outbound').at(-1)!
        const trunkRetFirst = trunkSegs.find((x) => x.leg === 'return')!
        const home = posBackSegs[posBackSegs.length - 1]!
        doorMinutesWeighted +=
          travelersOf(s.party_id) *
          (minutesBetween(dep.departsLocal, dep.originTz, trunkOutLast.arrivesLocal, trunkOutLast.destTz) +
            minutesBetween(trunkRetFirst.departsLocal, trunkRetFirst.originTz, home.arrivesLocal, home.destTz))
        doorTravelers += travelersOf(s.party_id)
      }
      const personalAvg = personal.reduce((a, b) => a + b, 0) / personal.length
      const timeQuality = (chinaArrQ + chinaDepQ + 2 * personalAvg) / 4

      metrics = {
        total_travel_time: Math.round(doorMinutesWeighted / doorTravelers),
        group_total: totalCents,
        fairness: perPersonMax - perPersonMin,
        trunk_duration: outSummary.elapsedMin + retSummary.elapsedMin,
        trunk_layovers:
          (outTrunkSegs.length - 1 + retTrunkSegs.length - 1) * 90 +
          layoverMinutes(outTrunkSegs) + layoverMinutes(retTrunkSegs),
        time_quality: timeQuality,
      }
    }

    const flags: string[] = []
    if (splitDtos.length > 0) flags.push('split_ticket')
    if (!priceable) flags.push('incomplete')

    options.push({
      id: optionId(outKey, retKey),
      outboundTrunkKey: outKey,
      returnTrunkKey: retKey,
      gatewayOut,
      gatewayIn,
      gatewayOutUS: isUSAirport(gatewayOut),
      gatewayInUS: isUSAirport(gatewayIn),
      departDate: parsedOut.firstDate,
      returnDate: parsedRet.firstDate,
      pairDepart: repRow.dep_date,
      pairReturn: repRow.ret_date,
      outbound: trunkSummary(outKey, outTrunkSegs),
      ret: trunkSummary(retKey, retTrunkSegs),
      complete,
      missingParties: stillMissing,
      splitParties,
      flags,
      parties: partyDtos,
      splitTickets: splitDtos,
      totalCents,
      perPersonMinCents: perPersonMin,
      perPersonMaxCents: perPersonMax,
      currency: partyDtos[0]?.currency ?? 'USD',
      totalTravelers: cfg.parties.reduce((s, p) => s + p.travelers, 0),
      metrics,
    })
  }

  return options
}

export function findOption(
  db: DB,
  cfg: TripConfig,
  id: string,
  withSegments = true,
  provider?: string,
): GroupOptionDto | undefined {
  return assembleOptions(db, cfg, { includeIncomplete: true, withSegments, provider }).find(
    (o) => o.id === id,
  )
}
