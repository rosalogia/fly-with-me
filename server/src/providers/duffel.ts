import type { FlightProvider, ProviderOffer, ProviderSegment, SearchParams } from './types.js'

const API = 'https://api.duffel.com/air/offer_requests?return_offers=true'

interface DuffelPlace {
  iata_code: string
  time_zone?: string | null
}

interface DuffelSegment {
  marketing_carrier: { iata_code: string }
  marketing_carrier_flight_number: string
  operating_carrier?: { iata_code: string } | null
  origin: DuffelPlace
  destination: DuffelPlace
  departing_at: string
  arriving_at: string
  duration?: string | null
  aircraft?: { name: string } | null
}

interface DuffelOffer {
  id: string
  total_amount: string
  total_currency: string
  slices: { segments: DuffelSegment[] }[]
}

function isoDurationToMin(d: string | null | undefined): number | null {
  if (!d) return null
  const m = d.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/)
  if (!m) return null
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}

function mapSegment(s: DuffelSegment): ProviderSegment {
  return {
    carrier: s.marketing_carrier.iata_code,
    flightNumber: s.marketing_carrier_flight_number,
    operatingCarrier: s.operating_carrier?.iata_code ?? null,
    origin: s.origin.iata_code,
    destination: s.destination.iata_code,
    departsLocal: s.departing_at.replace(/(Z|[+-]\d{2}:\d{2})$/, ''),
    arrivesLocal: s.arriving_at.replace(/(Z|[+-]\d{2}:\d{2})$/, ''),
    originTz: s.origin.time_zone ?? null,
    destTz: s.destination.time_zone ?? null,
    durationMin: isoDurationToMin(s.duration),
    aircraft: s.aircraft?.name ?? null,
  }
}

export function duffelProvider(token: string): FlightProvider {
  return {
    // Distinct names keep test-mode and live caches/results from ever mixing.
    name: token.startsWith('duffel_test') ? 'duffel_test' : 'duffel',
    async search(params: SearchParams): Promise<ProviderOffer[]> {
      const body = {
        data: {
          slices: params.slices.map((s) => ({
            origin: s.origin,
            destination: s.destination,
            departure_date: s.departureDate,
            ...(s.departAfterLocal
              ? { departure_time: { from: s.departAfterLocal, to: '23:59' } }
              : {}),
          })),
          passengers: Array.from({ length: params.travelers }, () => ({ type: 'adult' as const })),
          cabin_class: params.cabin,
          max_connections: params.maxConnections,
        },
      }

      let lastError = ''
      for (let attempt = 0; attempt < 5; attempt++) {
        const res = await fetch(API, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Duffel-Version': 'v2',
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(body),
        })
        if (res.status === 429 || res.status >= 500) {
          lastError = `duffel ${res.status}: ${(await res.text()).slice(0, 500)}`
          // Rate-limit windows are per-minute; honor the reset header when present.
          const resetHeader = res.headers.get('ratelimit-reset') ?? res.headers.get('retry-after')
          const resetMs = resetHeader ? Math.max(1000, Number(resetHeader) * 1000 || Date.parse(resetHeader) - Date.now()) : 0
          const backoffMs = Number.isFinite(resetMs) && resetMs > 0 ? resetMs + 500 : 15000 * (attempt + 1)
          await new Promise((r) => setTimeout(r, Math.min(backoffMs, 65000)))
          continue
        }
        if (!res.ok) {
          throw new Error(`duffel ${res.status}: ${(await res.text()).slice(0, 1000)}`)
        }
        const json = (await res.json()) as { data: { offers?: DuffelOffer[] } }
        return (json.data.offers ?? []).map((o) => ({
          offerId: o.id,
          totalAmountCents: Math.round(parseFloat(o.total_amount) * 100),
          currency: o.total_currency,
          slices: o.slices.map((sl) => sl.segments.map(mapSegment)),
        }))
      }
      throw new Error(lastError || 'duffel: retries exhausted')
    },
  }
}
