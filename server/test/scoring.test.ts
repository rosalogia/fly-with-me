import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PREFS, costAll, costBreakdown, parsePrefsParam,
  type GroupOptionDto, type OptionMetrics,
} from '@fwm/shared'

const metrics = (over: Partial<OptionMetrics> = {}): OptionMetrics => ({
  group_total: 800000, fairness: 20000, trunk_duration: 1600, trunk_layovers: 90,
  total_travel_time: 3000, time_quality: 0.8,
  ...over,
})

function option(over: Partial<GroupOptionDto> = {}): GroupOptionDto {
  return {
    id: 'x', outboundTrunkKey: 'k', returnTrunkKey: 'k', gatewayOut: 'LAX', gatewayIn: 'LAX',
    gatewayOutUS: true, gatewayInUS: true, departDate: '2026-10-09', returnDate: '2026-10-24',
    pairDepart: '2026-10-09', pairReturn: '2026-10-24',
    outbound: {} as GroupOptionDto['outbound'], ret: {} as GroupOptionDto['ret'],
    complete: true, missingParties: [], splitParties: [], flags: [], parties: [], splitTickets: [],
    totalCents: 800000, perPersonMinCents: 160000, perPersonMaxCents: 180000, currency: 'USD',
    totalTravelers: 5, metrics: metrics(),
    ...over,
  }
}

describe('parsePrefsParam', () => {
  it('parses dollar knobs and keeps defaults for the rest', () => {
    const p = parsePrefsParam('hourly:60,risk:800')
    expect(p.hourlyDollars).toBe(60)
    expect(p.splitRiskDollars).toBe(800)
    expect(p.hotelNightDollars).toBe(DEFAULT_PREFS.hotelNightDollars)
  })
  it('ignores junk and negatives', () => {
    const p = parsePrefsParam('hourly:-5,bogus:9,fairness:abc')
    expect(p).toEqual(DEFAULT_PREFS)
  })
})

describe('costBreakdown', () => {
  it('prices time, risk, hotels, odd hours and fairness in cents', () => {
    const o = option({
      splitTickets: [
        { partyId: 'SEA', totalCents: 0, perPersonCents: 0, currency: 'USD',
          bufferOutMin: 0, bufferBackMin: 0, overnightNights: 2, flags: [], components: [] },
      ],
    })
    const b = costBreakdown(o, { hourlyDollars: 20, splitRiskDollars: 300, hotelNightDollars: 150, fairnessPerDollar: 1, oddHoursDollars: 50 })!
    expect(b.ticketsCents).toBe(800000)
    expect(b.hotelCents).toBe(2 * 150 * 100)
    expect(b.riskCents).toBe(300 * 100)
    // 3000 min avg × 5 travelers = 250 person-hours × $20
    expect(b.timeCents).toBe(250 * 20 * 100)
    // (1 − 0.8) × $50 × 5 people
    expect(b.oddHoursCents).toBe(0.2 * 50 * 5 * 100)
    // $200 spread × 1
    expect(b.fairnessCents).toBe(20000)
    expect(b.totalCents).toBe(b.ticketsCents + b.hotelCents + b.riskCents + b.timeCents + b.oddHoursCents + b.fairnessCents)
  })

  it('fairness 0 = the group settles up, spread costs nothing', () => {
    const b = costBreakdown(option(), DEFAULT_PREFS)!
    expect(b.fairnessCents).toBe(0)
  })

  it('unpriceable option -> null', () => {
    expect(costBreakdown(option({ metrics: null, totalCents: null }), DEFAULT_PREFS)).toBeNull()
  })
})

describe('costAll pareto (fixed axes: cash, person-time, spread)', () => {
  it('flags dominated options as not-best', () => {
    const a = option({ totalCents: 700000, metrics: metrics({ total_travel_time: 3500 }) }) // cheap, slow
    const b = option({ totalCents: 900000, metrics: metrics({ total_travel_time: 2500 }) }) // pricey, fast
    const c = option({ totalCents: 950000, metrics: metrics({ total_travel_time: 3600 }) }) // dominated by both
    const results = costAll([a, b, c], DEFAULT_PREFS)
    expect(results.map((r) => r.pareto)).toEqual([true, true, false])
  })

  it('positioning hotel nights count as cash on the pareto axis', () => {
    const clean = option({ totalCents: 800000 })
    const withNights = option({
      totalCents: 799000, // $10 cheaper on tickets…
      splitTickets: [
        { partyId: 'SEA', totalCents: 0, perPersonCents: 0, currency: 'USD',
          bufferOutMin: 0, bufferBackMin: 0, overnightNights: 2, flags: [], components: [] },
      ], // …but 2 hotel nights ($300) make it strictly worse on cash
    })
    const results = costAll([clean, withNights], DEFAULT_PREFS)
    expect(results[0]!.pareto).toBe(true)
    expect(results[1]!.pareto).toBe(false)
  })

  it('incomplete options get null cost and are never best', () => {
    const results = costAll([option({ metrics: null, totalCents: null })], DEFAULT_PREFS)
    expect(results[0]).toMatchObject({
      trueCostCents: null, breakdown: null, cashCents: null,
      deltaVsBestCents: null, deltaBreakdown: null, benchmark: false, pareto: false,
    })
  })

  it('marks the lowest generalized cost as benchmark; deltas sum component-wise', () => {
    const cheapSlow = option({ totalCents: 700000, metrics: metrics({ total_travel_time: 3500 }) })
    const priceyFast = option({ totalCents: 900000, metrics: metrics({ total_travel_time: 2500 }) })
    const results = costAll([priceyFast, cheapSlow], DEFAULT_PREFS)
    // cheapSlow: 700000 + 3500*5/60*20*100 ≈ cheaper overall than priceyFast
    expect(results[1]!.benchmark).toBe(true)
    expect(results[1]!.deltaVsBestCents).toBe(0)
    const d = results[0]!.deltaBreakdown!
    expect(d.ticketsCents).toBe(200000)
    expect(d.timeCents).toBeLessThan(0) // faster than the benchmark
    const componentSum =
      d.ticketsCents + d.hotelCents + d.riskCents + d.timeCents + d.oddHoursCents + d.fairnessCents
    expect(componentSum).toBe(results[0]!.deltaVsBestCents)
    expect(results[0]!.cashCents).toBe(900000)
  })
})
