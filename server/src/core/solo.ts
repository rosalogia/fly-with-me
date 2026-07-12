import type { SoloCandidateDto, TripConfig } from '@fwm/shared'
import type { DB } from '../db/db.js'
import { deriveDatePairs } from '../fetch/datePairs.js'
import {
  CHINA_ARR_Q, CHINA_DEP_Q, HOME_ARR_Q, US_DEP_Q, curve, loadSegments,
} from './groupOptions.js'
import { localHour, minutesBetween } from './time.js'
import { parseTrunkKey } from './trunk.js'

interface Row {
  id: number
  party_id: string
  travelers: number
  per_person_cents: number
  dep_date: string
  ret_date: string
  outbound_trunk_key: string
  return_trunk_key: string
  nsegs: number
}

/**
 * Solo baseline candidates: for each party, their best independent open-jaw
 * itineraries if they abandoned the group entirely. Drawn from the SAME cached
 * search results the trunk matching uses — no extra provider queries.
 *
 * Candidate pool per party = cheapest ~80 by ticket price, plus ~40 with the
 * fewest segments (proxy for fastest — covers the case where a pricier nonstop
 * wins once time is priced). The client picks the best per prefs.
 */
export function soloCandidates(db: DB, cfg: TripConfig, provider: string): SoloCandidateDto[] {
  const validPairs = new Set(deriveDatePairs(cfg).map((p) => `${p.depart}|${p.ret}`))
  const out: SoloCandidateDto[] = []

  for (const party of cfg.parties) {
    const rows = db
      .prepare(
        `SELECT i.id, i.party_id, i.travelers, i.per_person_cents, i.dep_date, i.ret_date,
                i.outbound_trunk_key, i.return_trunk_key,
                (SELECT COUNT(*) FROM segments sg WHERE sg.itinerary_id = i.id) AS nsegs
         FROM itineraries i JOIN searches s ON s.id = i.search_id
         WHERE s.provider = ? AND i.kind = 'openjaw' AND i.party_id = ?
           AND i.outbound_trunk_key IS NOT NULL AND i.return_trunk_key IS NOT NULL`,
      )
      .all(provider, party.id) as Row[]

    const eligible = rows.filter((r) => {
      if (!validPairs.has(`${r.dep_date}|${r.ret_date}`)) return false
      const outParsed = parseTrunkKey(r.outbound_trunk_key)
      const retParsed = parseTrunkKey(r.return_trunk_key)
      return cfg.intoChina.includes(outParsed.lastDestination) && cfg.outOfChina.includes(retParsed.firstOrigin)
    })

    const byPrice = [...eligible].sort((a, b) => a.per_person_cents - b.per_person_cents).slice(0, 80)
    const byStops = [...eligible]
      .sort((a, b) => a.nsegs - b.nsegs || a.per_person_cents - b.per_person_cents)
      .slice(0, 40)
    const pool = new Map<number, Row>()
    for (const r of [...byPrice, ...byStops]) pool.set(r.id, r)

    for (const r of pool.values()) {
      const segs = loadSegments(db, r.id)
      const outSegs = segs.filter((s) => s.leg === 'outbound')
      const retSegs = segs.filter((s) => s.leg === 'return')
      if (outSegs.length === 0 || retSegs.length === 0) continue
      const oF = outSegs[0]!
      const oL = outSegs[outSegs.length - 1]!
      const rF = retSegs[0]!
      const rL = retSegs[retSegs.length - 1]!
      const doorMin =
        minutesBetween(oF.departsLocal, oF.originTz, oL.arrivesLocal, oL.destTz) +
        minutesBetween(rF.departsLocal, rF.originTz, rL.arrivesLocal, rL.destTz)
      const timeQuality =
        (curve(US_DEP_Q, localHour(oF.departsLocal)) +
          curve(CHINA_ARR_Q, localHour(oL.arrivesLocal)) +
          curve(CHINA_DEP_Q, localHour(rF.departsLocal)) +
          curve(HOME_ARR_Q, localHour(rL.arrivesLocal))) / 4
      out.push({
        partyId: party.id,
        itineraryId: r.id,
        travelers: r.travelers,
        perPersonCents: r.per_person_cents,
        doorMin,
        timeQuality,
        depDate: r.dep_date,
        retDate: r.ret_date,
      })
    }
  }
  return out
}
