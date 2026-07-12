import { describe, expect, it } from 'vitest'
import { outboundTrunkSegs, parseTrunkKey, returnTrunkSegs, trunkKey, type TrunkSeg } from '../src/core/trunk.js'

const seg = (
  carrier: string, num: string, origin: string, dest: string, dep: string, arr: string,
): TrunkSeg => ({
  carrier, flightNumber: num, origin, destination: dest,
  departsLocal: dep, arrivesLocal: arr, originTz: null, destTz: null,
})

describe('trunk extraction', () => {
  it('nonstop crossing: the whole itinerary is the trunk', () => {
    const segs = [seg('CA', '818', 'IAD', 'PEK', '2026-10-09T18:00:00', '2026-10-10T19:00:00')]
    const trunk = outboundTrunkSegs(segs)!
    expect(trunk).toHaveLength(1)
    expect(trunkKey(trunk)).toBe('CA818|2026-10-09|IAD-PEK')
  })

  it('outbound trunk is the suffix from the crossing, including Asia-side connections', () => {
    const segs = [
      seg('AS', '1010', 'IAD', 'SEA', '2026-10-09T17:30:00', '2026-10-09T20:30:00'),
      seg('KE', '20', 'SEA', 'ICN', '2026-10-09T23:00:00', '2026-10-11T04:00:00'),
      seg('KE', '855', 'ICN', 'PEK', '2026-10-11T08:00:00', '2026-10-11T09:10:00'),
    ]
    const trunk = outboundTrunkSegs(segs)!
    expect(trunk.map((s) => s.origin)).toEqual(['SEA', 'ICN'])
    expect(trunkKey(trunk)).toBe('KE20|2026-10-09|SEA-ICN>KE855|2026-10-11|ICN-PEK')
  })

  it('return trunk is the prefix through the crossing', () => {
    const segs = [
      seg('MU', '5402', 'CTU', 'PVG', '2026-10-24T08:00:00', '2026-10-24T11:15:00'),
      seg('MU', '587', 'PVG', 'LAX', '2026-10-24T13:00:00', '2026-10-24T10:00:00'),
      seg('AA', '2400', 'LAX', 'MIA', '2026-10-24T13:00:00', '2026-10-24T21:00:00'),
    ]
    const trunk = returnTrunkSegs(segs)!
    expect(trunk.map((s) => s.origin)).toEqual(['CTU', 'PVG'])
  })

  it('via-Europe routing: trunk anchors at the Asia-entering segment', () => {
    const segs = [
      seg('TK', '8', 'IAD', 'IST', '2026-10-09T21:45:00', '2026-10-10T14:40:00'),
      seg('TK', '196', 'IST', 'PEK', '2026-10-10T16:00:00', '2026-10-11T06:50:00'),
    ]
    const trunk = outboundTrunkSegs(segs)!
    expect(trunkKey(trunk)).toBe('TK196|2026-10-10|IST-PEK')

    const ret = [
      seg('TK', '8877', 'TFU', 'IST', '2026-10-24T01:35:00', '2026-10-24T07:10:00'),
      seg('TK', '7', 'IST', 'IAD', '2026-10-24T15:50:00', '2026-10-24T19:10:00'),
    ]
    const retTrunk = returnTrunkSegs(ret)!
    expect(retTrunk.map((s) => s.origin)).toEqual(['TFU'])
  })

  it('no crossing -> null', () => {
    const segs = [seg('AA', '100', 'MIA', 'JFK', '2026-10-09T08:00:00', '2026-10-09T11:00:00')]
    expect(outboundTrunkSegs(segs)).toBeNull()
    expect(returnTrunkSegs(segs)).toBeNull()
  })

  it('parseTrunkKey round-trips gateway and arrival', () => {
    const parsed = parseTrunkKey('KE20|2026-10-09|SEA-ICN>KE855|2026-10-11|ICN-PEK')
    expect(parsed.firstOrigin).toBe('SEA')
    expect(parsed.lastDestination).toBe('PEK')
    expect(parsed.firstDate).toBe('2026-10-09')
  })
})
