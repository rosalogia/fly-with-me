import { z } from 'zod'

export const GOAL_IDS = [
  'group_total',
  'fairness',
  'trunk_duration',
  'trunk_layovers',
  'total_travel_time',
  'time_quality',
] as const

export type GoalId = (typeof GOAL_IDS)[number]

const iata = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/, 'must be a 3-letter IATA code'))

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'must be HH:MM')

export const PartySchema = z.object({
  id: z.string().min(1),
  /** IATA city or airport codes to search from; each generates its own queries. */
  origins: z.array(iata).min(1),
  travelers: z.number().int().min(1),
})
export type Party = z.infer<typeof PartySchema>

export const TripConfigSchema = z.object({
  parties: z.array(PartySchema).min(1),
  /** Arrival airports in the destination country (e.g. PEK, PKX). Swap with outOfChina to reverse direction. */
  intoChina: z.array(iata).min(1),
  /** Departure airports for the return leg (e.g. TFU, CTU). */
  outOfChina: z.array(iata).min(1),
  /** Departure dates are searched within this range; return dates may extend past `end`. */
  dateRange: z.object({ start: isoDate, end: isoDate }),
  /** Day of week for departure, 0=Sunday..6=Saturday. */
  departDow: z.number().int().min(0).max(6).default(5),
  /** Earliest local departure time from home on the departure day. */
  departAfterLocal: hhmm.default('17:00'),
  /** Allowed days of week for the return departure from the destination country. */
  returnDow: z.array(z.number().int().min(0).max(6)).min(1).default([6, 0]),
  /** Candidate trip lengths in days (return date = depart date + N). */
  tripLenDays: z.array(z.number().int().min(1)).min(1).default([15, 16]),
  cabin: z.enum(['economy', 'premium_economy', 'business', 'first']).default('economy'),
  maxConnections: z.number().int().min(0).max(2).default(2),
  /** Optional post-filter on trunk gateways; null = allow all discovered gateways. */
  gatewayAllowlist: z.array(iata).nullable().default(null),
  /** Minimum self-transfer buffer (minutes) for split-ticket options. */
  minSelfTransferMin: z.number().int().min(0).default(180),
})
export type TripConfig = z.infer<typeof TripConfigSchema>

export const DEFAULT_CONFIG: TripConfig = TripConfigSchema.parse({
  parties: [
    { id: 'DC', origins: ['WAS'], travelers: 2 },
    { id: 'SEA', origins: ['SEA'], travelers: 2 },
    { id: 'MIA', origins: ['MIA'], travelers: 1 },
  ],
  intoChina: ['PEK', 'PKX'],
  outOfChina: ['TFU', 'CTU'],
  dateRange: { start: '2026-10-08', end: '2026-10-31' },
})
