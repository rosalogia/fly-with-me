import type { GoalId } from './config.js'
import type { ScoringResult } from './scoring.js'

export interface SegmentDto {
  leg: 'outbound' | 'return'
  pos: number
  carrier: string
  flightNumber: string
  operatingCarrier: string | null
  origin: string
  destination: string
  /** ISO local datetime without offset, in the airport's local time. */
  departsLocal: string
  arrivesLocal: string
  originTz: string
  destTz: string
  durationMin: number | null
  aircraft: string | null
  isTrunk: boolean
  /** Connection time before this segment (null for the first segment of a leg). */
  layoverBeforeMin?: number | null
}

export interface PartyItineraryDto {
  partyId: string
  itineraryId: number
  kind: 'openjaw' | 'trunk_only' | 'positioning_out' | 'positioning_back'
  travelers: number
  totalCents: number
  perPersonCents: number
  currency: string
  segments?: SegmentDto[]
}

/** Raw (un-normalized) metric values; lower is better except time_quality. */
export type OptionMetrics = Record<GoalId, number>

export interface SplitTicketDto {
  partyId: string
  totalCents: number
  perPersonCents: number
  currency: string
  bufferOutMin: number
  bufferBackMin: number
  /** Nights spent positioning at gateways (drives the hotel-cost estimate). */
  overnightNights: number
  flags: string[]
  components: PartyItineraryDto[]
}

export interface TrunkLegSummary {
  key: string
  segments: { carrier: string; flightNumber: string; origin: string; destination: string; date: string }[]
  departsLocal: string
  arrivesLocal: string
  elapsedMin: number
  layovers: number
}

export interface GroupOptionDto {
  id: string
  outboundTrunkKey: string
  returnTrunkKey: string
  gatewayOut: string
  gatewayIn: string
  /** True when the meeting gateway is a US airport (false = foreign or unknown). */
  gatewayOutUS: boolean
  gatewayInUS: boolean
  /** Trunk-segment departure dates (what everyone must share). */
  departDate: string
  returnDate: string
  /** The searched date pair: when travelers leave home / leave China. */
  pairDepart: string
  pairReturn: string
  outbound: TrunkLegSummary
  ret: TrunkLegSummary
  /** Every party covered by a single-ticket itinerary. */
  complete: boolean
  /** Parties with no single-ticket itinerary and no synthesized split ticket. */
  missingParties: string[]
  /** Parties covered via synthesized split tickets. */
  splitParties: string[]
  flags: string[]
  parties: PartyItineraryDto[]
  splitTickets: SplitTicketDto[]
  /** Null when the option has uncovered parties (not priceable). */
  totalCents: number | null
  perPersonMinCents: number | null
  perPersonMaxCents: number | null
  currency: string
  /** Sum of travelers across all parties (for person-hour pricing). */
  totalTravelers: number
  metrics: OptionMetrics | null
}

export interface ScoredOptionDto extends GroupOptionDto, ScoringResult {}

export interface DatePair {
  depart: string
  ret: string
}

/** One candidate itinerary for a party flying ALONE (ignoring the group). */
export interface SoloCandidateDto {
  partyId: string
  itineraryId: number
  travelers: number
  perPersonCents: number
  /** Their door-to-door minutes, round trip. */
  doorMin: number
  /** Same 0..1 time-of-day quality the group metric uses. */
  timeQuality: number
  depDate: string
  retDate: string
}

export interface RefreshJobDto {
  id: string
  status: 'running' | 'done' | 'error'
  total: number
  done: number
  skippedCacheHits: number
  errors: string[]
  startedAt: string
  finishedAt: string | null
}

export interface CacheStatsDto {
  searches: number
  okSearches: number
  errorSearches: number
  itineraries: number
  lastFetchedAt: string | null
  estimatedFullRefreshQueries: number
  /** How many of the active config's planned searches are already cached. */
  cachedQueries: number
}
