import type { GroupOptionDto, TripConfig } from '@fwm/shared'
import type { DB } from '../db/db.js'
import { executeSpec } from '../fetch/fetcher.js'
import type { SearchSpec } from '../fetch/queryPlanner.js'
import type { FlightProvider } from '../providers/types.js'
import { addDays, minutesBetween, sundayDeadline } from './time.js'
import { findOption } from './groupOptions.js'
import { parseTrunkKey } from './trunk.js'

interface SegLite {
  origin: string
  destination: string
  departs_local: string
  arrives_local: string
  origin_tz: string
  dest_tz: string
}

interface CandidateItin {
  id: number
  total_cents: number
  currency: string
  segments: SegLite[]
}

function loadCandidates(
  db: DB,
  provider: string,
  kind: string,
  partyId: string,
  depDates: string[],
): CandidateItin[] {
  const placeholders = depDates.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT i.id, i.total_cents, i.currency FROM itineraries i
       JOIN searches s ON s.id = i.search_id
       WHERE s.provider = ? AND i.kind = ? AND i.party_id = ? AND i.dep_date IN (${placeholders})`,
    )
    .all(provider, kind, partyId, ...depDates) as { id: number; total_cents: number; currency: string }[]
  const segStmt = db.prepare(
    `SELECT origin, destination, departs_local, arrives_local, origin_tz, dest_tz
     FROM segments WHERE itinerary_id = ? ORDER BY pos ASC`,
  )
  return rows.map((r) => ({ ...r, segments: segStmt.all(r.id) as SegLite[] }))
}

export interface SynthesisReport {
  partyId: string
  ok: boolean
  reason?: string
}

/**
 * For each party missing from the option's trunk pair, price the trunk as a
 * standalone ticket plus separate positioning flights, and persist the best
 * combination as a split ticket. Lazy and budgeted: ~3-6 provider searches per
 * missing party, all cache-aware.
 */
export async function synthesizeSplitTickets(
  db: DB,
  provider: FlightProvider,
  cfg: TripConfig,
  id: string,
): Promise<{ option: GroupOptionDto | undefined; reports: SynthesisReport[] }> {
  const option = findOption(db, cfg, id, false, provider.name)
  if (!option) return { option: undefined, reports: [] }
  if (option.missingParties.length === 0) return { option, reports: [] }

  const outParsed = parseTrunkKey(option.outboundTrunkKey)
  const retParsed = parseTrunkKey(option.returnTrunkKey)
  const gwOut = outParsed.firstOrigin
  const intoAirport = outParsed.lastDestination
  const outAirport = retParsed.firstOrigin
  const gwIn = retParsed.lastDestination
  const departDate = outParsed.firstDate
  const returnDate = retParsed.firstDate

  const reports: SynthesisReport[] = []

  for (const partyId of option.missingParties) {
    const party = cfg.parties.find((p) => p.id === partyId)
    if (!party) continue
    const homeOrigin = party.origins[0]!

    // 1. Price the trunk itself from its gateway.
    const trunkSpec: SearchSpec = {
      kind: 'trunk_only',
      partyId,
      depDate: departDate,
      retDate: returnDate,
      params: {
        slices: [
          { origin: gwOut, destination: intoAirport, departureDate: departDate },
          { origin: outAirport, destination: gwIn, departureDate: returnDate },
        ],
        travelers: party.travelers,
        cabin: cfg.cabin,
        maxConnections: cfg.maxConnections,
      },
    }
    await executeSpec(db, provider, trunkSpec, cfg)
    const trunkRow = db
      .prepare(
        `SELECT i.id, i.total_cents, i.currency FROM itineraries i
         JOIN searches s ON s.id = i.search_id
         WHERE s.provider = ? AND i.kind = 'trunk_only' AND i.party_id = ?
           AND i.outbound_trunk_key = ? AND i.return_trunk_key = ?
         ORDER BY i.total_cents ASC LIMIT 1`,
      )
      .get(provider.name, partyId, option.outboundTrunkKey, option.returnTrunkKey) as
      | { id: number; total_cents: number; currency: string }
      | undefined
    if (!trunkRow) {
      reports.push({ partyId, ok: false, reason: 'trunk not bookable as a standalone ticket' })
      continue
    }

    const trunkSegs = db
      .prepare(
        `SELECT origin, destination, departs_local, arrives_local, origin_tz, dest_tz, leg
         FROM segments WHERE itinerary_id = ? ORDER BY leg DESC, pos ASC`,
      )
      .all(trunkRow.id) as (SegLite & { leg: string })[]
    const outboundSegs = trunkSegs.filter((s) => s.leg === 'outbound')
    const returnSegs = trunkSegs.filter((s) => s.leg === 'return')
    const trunkDep = outboundSegs[0]!
    const trunkArr = returnSegs[returnSegs.length - 1]!

    // 2. Positioning to the gateway: trunk's departure day, plus up to two days
    //    before (far gateways like IST need a Friday departure for a Sunday trunk).
    const trunkDepDate = trunkDep.departs_local.slice(0, 10)
    const posOutDates = [trunkDepDate, addDays(trunkDepDate, -1), addDays(trunkDepDate, -2)]
    for (const d of posOutDates) {
      const spec: SearchSpec = {
        kind: 'positioning', partyId, posDirection: 'out', depDate: d,
        params: {
          slices: [{ origin: homeOrigin, destination: gwOut, departureDate: d, departAfterLocal: cfg.departAfterLocal }],
          travelers: party.travelers, cabin: cfg.cabin, maxConnections: 1,
        },
      }
      await executeSpec(db, provider, spec, cfg)
    }
    const posOutCandidates = loadCandidates(db, provider.name, 'positioning_out', partyId, posOutDates)
      .filter((c) => c.segments[c.segments.length - 1]!.destination === gwOut)
      .map((c) => {
        const arr = c.segments[c.segments.length - 1]!
        const buffer = minutesBetween(arr.arrives_local, arr.dest_tz, trunkDep.departs_local, trunkDep.origin_tz)
        return { ...c, buffer, overnight: arr.arrives_local.slice(0, 10) !== trunkDepDate }
      })
      .filter((c) => c.buffer >= cfg.minSelfTransferMin && c.buffer <= (c.overnight ? 36 * 60 : 24 * 60))
      .sort((a, b) => a.total_cents - b.total_cents)
    const posOut = posOutCandidates[0]
    if (!posOut) {
      reports.push({ partyId, ok: false, reason: `no positioning flight to ${gwOut} with >=${cfg.minSelfTransferMin}min buffer` })
      continue
    }

    // 3. Positioning home from the arrival gateway.
    const trunkArrDate = trunkArr.arrives_local.slice(0, 10)
    const posBackDates = [trunkArrDate, addDays(trunkArrDate, 1)]
    for (const d of posBackDates) {
      const spec: SearchSpec = {
        kind: 'positioning', partyId, posDirection: 'back', depDate: d,
        params: {
          slices: [{ origin: gwIn, destination: homeOrigin, departureDate: d }],
          travelers: party.travelers, cabin: cfg.cabin, maxConnections: 1,
        },
      }
      await executeSpec(db, provider, spec, cfg)
    }
    const deadline = sundayDeadline(returnDate)
    const posBackCandidates = loadCandidates(db, provider.name, 'positioning_back', partyId, posBackDates)
      .filter((c) => c.segments[0]!.origin === gwIn && c.segments[c.segments.length - 1]!.destination === homeOrigin)
      .map((c) => {
        const dep = c.segments[0]!
        const buffer = minutesBetween(trunkArr.arrives_local, trunkArr.dest_tz, dep.departs_local, dep.origin_tz)
        return { ...c, buffer }
      })
      .filter((c) => c.buffer >= cfg.minSelfTransferMin && c.segments[c.segments.length - 1]!.arrives_local <= deadline)
      .sort((a, b) => a.total_cents - b.total_cents)
    const posBack = posBackCandidates[0]
    if (!posBack) {
      reports.push({ partyId, ok: false, reason: `no positioning flight home from ${gwIn} meeting buffer + Sunday-night deadline` })
      continue
    }

    const flags = ['self_transfer_risk']
    if (posOut.overnight) flags.push('overnight_positioning')

    db.prepare(
      `INSERT OR REPLACE INTO split_tickets
        (outbound_trunk_key, return_trunk_key, party_id, trunk_itin_id, pos_out_itin_id, pos_back_itin_id,
         total_cents, currency, buffer_out_min, buffer_back_min, flags_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      option.outboundTrunkKey, option.returnTrunkKey, partyId,
      trunkRow.id, posOut.id, posBack.id,
      trunkRow.total_cents + posOut.total_cents + posBack.total_cents,
      trunkRow.currency, posOut.buffer, posBack.buffer,
      JSON.stringify(flags), new Date().toISOString(),
    )
    reports.push({ partyId, ok: true })
  }

  return { option: findOption(db, cfg, id, false, provider.name), reports }
}
