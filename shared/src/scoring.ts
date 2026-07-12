import type { GroupOptionDto, SoloCandidateDto } from './types.js'

/**
 * Generalized-cost scoring: every preference is a dollar amount, and an option's
 * "true cost" is real ticket money plus the dollar value of everything else you
 * give up. Interpretable, stable under filtering, and the knobs are exchange
 * rates a person can actually reason about.
 */
export interface CostPrefs {
  /** $ per person-hour spent traveling (door-to-door — "time not in China"). */
  hourlyDollars: number
  /** $ penalty per party traveling on split (self-transfer) tickets. */
  splitRiskDollars: number
  /** $ per party per overnight spent positioning at a gateway (hotel + meals). */
  hotelNightDollars: number
  /** Penalty per $1 of per-person price spread. 0 = the group settles up after. */
  fairnessPerDollar: number
  /** Max $ per person for awful flight times (scaled by 1 − time_quality). */
  oddHoursDollars: number
}

export const DEFAULT_PREFS: CostPrefs = {
  hourlyDollars: 20,
  splitRiskDollars: 300,
  hotelNightDollars: 150,
  fairnessPerDollar: 0,
  oddHoursDollars: 50,
}

export const PREF_LABELS: Record<keyof CostPrefs, { label: string; hint: string }> = {
  hourlyDollars: {
    label: '$ / hour away',
    hint: 'What an hour of travel time is worth to you, per person. Higher = prefer faster options.',
  },
  splitRiskDollars: {
    label: '$ / split-ticket party',
    hint: 'How much you would pay to avoid one party being on unprotected separate tickets.',
  },
  hotelNightDollars: {
    label: '$ / positioning night',
    hint: 'Estimated hotel + meals when a party overnights at the meeting airport (real cash, just not on a ticket).',
  },
  fairnessPerDollar: {
    label: 'fairness penalty / $',
    hint: 'Penalty per dollar of gap between cheapest and priciest traveler. Leave 0 if you settle up afterwards.',
  },
  oddHoursDollars: {
    label: '$ / person for bad hours',
    hint: 'Max penalty per person for red-eye arrivals and dawn departures (scaled by how bad the times are).',
  },
}

/** Serialize prefs to the API's compact param form. */
export function prefsToParam(p: CostPrefs): string {
  return `hourly:${p.hourlyDollars},risk:${p.splitRiskDollars},hotel:${p.hotelNightDollars},fairness:${p.fairnessPerDollar},odd:${p.oddHoursDollars}`
}

/** Parse "hourly:20,risk:300,hotel:150,fairness:0,odd:50" (all dollars). */
export function parsePrefsParam(prefs?: string | null): CostPrefs {
  const out: CostPrefs = { ...DEFAULT_PREFS }
  if (!prefs) return out
  const keys: Record<string, keyof CostPrefs> = {
    hourly: 'hourlyDollars',
    risk: 'splitRiskDollars',
    hotel: 'hotelNightDollars',
    fairness: 'fairnessPerDollar',
    odd: 'oddHoursDollars',
  }
  for (const part of prefs.split(',')) {
    const [k, raw] = part.split(':').map((s) => s.trim())
    const key = k ? keys[k] : undefined
    const val = Number(raw)
    if (key && Number.isFinite(val) && val >= 0) out[key] = val
  }
  return out
}

export interface CostBreakdown {
  /** Ticket prices for everyone (the number you'd actually pay airlines). */
  ticketsCents: number
  /** Estimated positioning hotel/meal cash for split parties. */
  hotelCents: number
  /** Priced risk of unprotected self-transfers. */
  riskCents: number
  /** Person-hours away, priced at hourlyDollars. */
  timeCents: number
  /** Odd-hours discomfort. */
  oddHoursCents: number
  /** Per-person price spread, priced at fairnessPerDollar. */
  fairnessCents: number
  totalCents: number
}

export function costBreakdown(o: GroupOptionDto, p: CostPrefs): CostBreakdown | null {
  if (!o.metrics || o.totalCents == null) return null
  const nights = o.splitTickets.reduce((s, t) => s + t.overnightNights, 0)
  const personMinutes = o.metrics.total_travel_time * o.totalTravelers
  const ticketsCents = o.totalCents
  const hotelCents = Math.round(nights * p.hotelNightDollars * 100)
  const riskCents = Math.round(o.splitTickets.length * p.splitRiskDollars * 100)
  const timeCents = Math.round((personMinutes / 60) * p.hourlyDollars * 100)
  const oddHoursCents = Math.round(
    (1 - o.metrics.time_quality) * p.oddHoursDollars * o.totalTravelers * 100,
  )
  const fairnessCents = Math.round(o.metrics.fairness * p.fairnessPerDollar)
  return {
    ticketsCents,
    hotelCents,
    riskCents,
    timeCents,
    oddHoursCents,
    fairnessCents,
    totalCents: ticketsCents + hotelCents + riskCents + timeCents + oddHoursCents + fairnessCents,
  }
}

/**
 * Pareto frontier over three FIXED orthogonal axes (lower = better):
 *   cash  = tickets + positioning hotels (real money out the door)
 *   time  = person-minutes away
 *   spread = per-person price gap
 * Fixed axes keep "best" meaningful — dominance over many correlated goals
 * marks nearly everything as best.
 */
export function paretoAxes(o: GroupOptionDto): [number, number, number] | null {
  if (!o.metrics || o.totalCents == null) return null
  const nights = o.splitTickets.reduce((s, t) => s + t.overnightNights, 0)
  return [
    o.totalCents + Math.round(nights * DEFAULT_PREFS.hotelNightDollars * 100),
    o.metrics.total_travel_time * o.totalTravelers,
    o.metrics.fairness,
  ]
}

/** Per-person generalized cost of a solo candidate (no risk/hotel/fairness — one ticket, one person's terms). */
export function soloGcCents(c: SoloCandidateDto, p: CostPrefs): number {
  return (
    c.perPersonCents +
    Math.round((c.doorMin / 60) * p.hourlyDollars * 100) +
    Math.round((1 - c.timeQuality) * p.oddHoursDollars * 100)
  )
}

/**
 * For each party, the best solo candidate under the given prefs — optionally
 * pinned to one date pair, for like-for-like comparison against a group option
 * on those dates.
 */
export function pickSoloBest(
  candidates: SoloCandidateDto[],
  prefs: CostPrefs,
  pair?: { depDate: string; retDate: string },
): Map<string, SoloCandidateDto> {
  const best = new Map<string, SoloCandidateDto>()
  for (const c of candidates) {
    if (pair && (c.depDate !== pair.depDate || c.retDate !== pair.retDate)) continue
    const cur = best.get(c.partyId)
    if (!cur || soloGcCents(c, prefs) < soloGcCents(cur, prefs)) best.set(c.partyId, c)
  }
  return best
}

export interface ScoringResult {
  /** Absolute generalized cost — used for ordering; not shown as a headline. */
  trueCostCents: number | null
  breakdown: CostBreakdown | null
  /** Real money out the door: tickets + estimated positioning hotels. */
  cashCents: number | null
  /**
   * The decision-relevant number: what picking this option over the benchmark
   * (lowest generalized cost in this result set) effectively costs. Only
   * differences matter — the unavoidable travel-time floor cancels out here.
   */
  deltaVsBestCents: number | null
  /** Component-wise delta vs the benchmark; entries sum to deltaVsBestCents. */
  deltaBreakdown: CostBreakdown | null
  /** True for the option(s) with the lowest generalized cost in the set. */
  benchmark: boolean
  pareto: boolean
}

export function costAll(options: GroupOptionDto[], prefs: CostPrefs): ScoringResult[] {
  const axes = options.map(paretoAxes)
  const pareto = axes.map((a, i) => {
    if (!a) return false
    for (let j = 0; j < axes.length; j++) {
      const b = axes[j]
      if (i === j || !b) continue
      if (b[0] <= a[0] && b[1] <= a[1] && b[2] <= a[2] && (b[0] < a[0] || b[1] < a[1] || b[2] < a[2])) {
        return false
      }
    }
    return true
  })

  const breakdowns = options.map((o) => costBreakdown(o, prefs))
  let benchmarkIdx = -1
  for (let i = 0; i < breakdowns.length; i++) {
    const b = breakdowns[i]
    if (b && (benchmarkIdx === -1 || b.totalCents < breakdowns[benchmarkIdx]!.totalCents)) {
      benchmarkIdx = i
    }
  }
  const bench = benchmarkIdx >= 0 ? breakdowns[benchmarkIdx]! : null

  return options.map((o, i) => {
    const breakdown = breakdowns[i] ?? null
    const deltaBreakdown =
      breakdown && bench
        ? {
            ticketsCents: breakdown.ticketsCents - bench.ticketsCents,
            hotelCents: breakdown.hotelCents - bench.hotelCents,
            riskCents: breakdown.riskCents - bench.riskCents,
            timeCents: breakdown.timeCents - bench.timeCents,
            oddHoursCents: breakdown.oddHoursCents - bench.oddHoursCents,
            fairnessCents: breakdown.fairnessCents - bench.fairnessCents,
            totalCents: breakdown.totalCents - bench.totalCents,
          }
        : null
    return {
      trueCostCents: breakdown?.totalCents ?? null,
      breakdown,
      cashCents: breakdown ? breakdown.ticketsCents + breakdown.hotelCents : null,
      deltaVsBestCents: deltaBreakdown?.totalCents ?? null,
      deltaBreakdown,
      benchmark: i === benchmarkIdx,
      pareto: pareto[i]!,
    }
  })
}
