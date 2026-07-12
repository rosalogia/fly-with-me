import { createContext, useContext, useMemo } from 'react'
import { tripApi, type TripApi } from '../api/client.js'

const TripContext = createContext<TripApi | null>(null)

export function TripProvider({ tripId, children }: { tripId: string; children: React.ReactNode }) {
  const api = useMemo(() => tripApi(tripId), [tripId])
  return <TripContext.Provider value={api}>{children}</TripContext.Provider>
}

/** The current trip's API (components under a TripProvider only). */
export function useTripApi(): TripApi {
  const api = useContext(TripContext)
  if (!api) throw new Error('useTripApi outside TripProvider')
  return api
}

/** Same, but null outside a TripProvider (e.g. frozen snapshot views). */
export function useTripApiOptional(): TripApi | null {
  return useContext(TripContext)
}
