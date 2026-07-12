export interface SliceSpec {
  origin: string
  destination: string
  /** YYYY-MM-DD local departure date of the slice's first segment. */
  departureDate: string
  /** HH:MM earliest local departure time (maps to Duffel departure_time.from). */
  departAfterLocal?: string
}

export interface SearchParams {
  slices: SliceSpec[]
  travelers: number
  cabin: string
  maxConnections: number
}

export interface ProviderSegment {
  carrier: string
  flightNumber: string
  operatingCarrier: string | null
  origin: string
  destination: string
  /** ISO local datetime without offset, in the airport's local time. */
  departsLocal: string
  arrivesLocal: string
  originTz: string | null
  destTz: string | null
  durationMin: number | null
  aircraft: string | null
}

export interface ProviderOffer {
  offerId: string | null
  totalAmountCents: number
  currency: string
  /** One segment array per requested slice, in request order. */
  slices: ProviderSegment[][]
}

export interface FlightProvider {
  name: string
  search(params: SearchParams): Promise<ProviderOffer[]>
}
