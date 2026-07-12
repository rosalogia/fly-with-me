import type { SegmentDto } from '@fwm/shared'

/**
 * "Verify & book" deep links. We can't link to a guaranteed fare (provider
 * offers expire in minutes), so we link to PREFILLED searches on booking
 * platforms for the same route and dates — the user matches the flight numbers
 * shown in the app and books there.
 */

export interface BookingLink {
  label: string
  url: string
}

interface Leg {
  origin: string
  destination: string
  date: string // YYYY-MM-DD
}

function kayakUrl(legs: Leg[]): string {
  const path = legs.map((l) => `${l.origin}-${l.destination}/${l.date}`).join('/')
  return `https://www.kayak.com/flights/${path}?sort=bestflight_a`
}

function googleFlightsUrl(legs: Leg[]): string {
  const q =
    legs.length === 1
      ? `one way flights from ${legs[0]!.origin} to ${legs[0]!.destination} on ${legs[0]!.date}`
      : `flights ${legs.map((l) => `from ${l.origin} to ${l.destination} on ${l.date}`).join(' and ')}`
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`
}

export function linksForLegs(legs: Leg[]): BookingLink[] {
  if (legs.length === 0) return []
  return [
    { label: 'Kayak', url: kayakUrl(legs) },
    { label: 'Google Flights', url: googleFlightsUrl(legs) },
  ]
}

/** Legs for a ticket from its segments: one leg per direction (first origin -> last destination). */
export function ticketLegs(segments: SegmentDto[]): Leg[] {
  const legs: Leg[] = []
  for (const dir of ['outbound', 'return'] as const) {
    const segs = segments.filter((s) => s.leg === dir)
    if (segs.length === 0) continue
    legs.push({
      origin: segs[0]!.origin,
      destination: segs[segs.length - 1]!.destination,
      date: segs[0]!.departsLocal.slice(0, 10),
    })
  }
  return legs
}
