/**
 * Static IATA -> IANA timezone fallback, used when the provider response lacks
 * timezone info and by the fixture provider. Covers airports plausibly involved
 * in US<->China itineraries; unknown codes fall back to null and the segment's
 * provider-supplied tz (if any) wins.
 */
const AIRPORT_TZ: Record<string, string> = {
  // US East
  IAD: 'America/New_York', DCA: 'America/New_York', BWI: 'America/New_York', WAS: 'America/New_York',
  JFK: 'America/New_York', EWR: 'America/New_York', LGA: 'America/New_York', NYC: 'America/New_York',
  BOS: 'America/New_York', MIA: 'America/New_York', FLL: 'America/New_York', ATL: 'America/New_York',
  DTW: 'America/New_York', PHL: 'America/New_York', CLT: 'America/New_York',
  // US Central / Mountain
  ORD: 'America/Chicago', DFW: 'America/Chicago', IAH: 'America/Chicago', MSP: 'America/Chicago',
  DEN: 'America/Denver', SLC: 'America/Denver', PHX: 'America/Phoenix',
  // US West
  SEA: 'America/Los_Angeles', SFO: 'America/Los_Angeles', LAX: 'America/Los_Angeles',
  SAN: 'America/Los_Angeles', PDX: 'America/Los_Angeles', SJC: 'America/Los_Angeles', LAS: 'America/Los_Angeles',
  HNL: 'Pacific/Honolulu',
  // Canada
  YVR: 'America/Vancouver', YYZ: 'America/Toronto',
  // China
  PEK: 'Asia/Shanghai', PKX: 'Asia/Shanghai', PVG: 'Asia/Shanghai', SHA: 'Asia/Shanghai',
  CTU: 'Asia/Shanghai', TFU: 'Asia/Shanghai', CKG: 'Asia/Shanghai', CAN: 'Asia/Shanghai',
  SZX: 'Asia/Shanghai', HGH: 'Asia/Shanghai', XIY: 'Asia/Shanghai', KMG: 'Asia/Shanghai',
  // Asia connections
  ICN: 'Asia/Seoul', GMP: 'Asia/Seoul',
  NRT: 'Asia/Tokyo', HND: 'Asia/Tokyo', KIX: 'Asia/Tokyo',
  HKG: 'Asia/Hong_Kong', TPE: 'Asia/Taipei', MNL: 'Asia/Manila', SIN: 'Asia/Singapore',
}

export function airportTz(iata: string): string | null {
  return AIRPORT_TZ[iata.toUpperCase()] ?? null
}

/** US airports/city codes (for the US-vs-foreign gateway comparison). Unknown codes
 *  are treated as non-US — trunk gateways are major hubs, which this list covers. */
const US_AIRPORTS = new Set([
  'IAD', 'DCA', 'BWI', 'WAS', 'JFK', 'EWR', 'LGA', 'NYC', 'BOS', 'MIA', 'FLL', 'ATL',
  'DTW', 'PHL', 'CLT', 'ORD', 'DFW', 'IAH', 'MSP', 'DEN', 'SLC', 'PHX',
  'SEA', 'SFO', 'LAX', 'SAN', 'PDX', 'SJC', 'LAS', 'HNL',
])

export function isUSAirport(iata: string): boolean {
  return US_AIRPORTS.has(iata.toUpperCase())
}
