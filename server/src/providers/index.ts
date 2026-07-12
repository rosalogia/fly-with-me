import { duffelProvider } from './duffel.js'
import { fixtureProvider } from './fixture.js'
import type { FlightProvider } from './types.js'

export function getProvider(): FlightProvider {
  const explicit = process.env.PROVIDER
  const token = process.env.DUFFEL_TOKEN
  if (explicit === 'fixture') return fixtureProvider()
  if (explicit === 'duffel' || token) {
    if (!token) throw new Error('PROVIDER=duffel requires DUFFEL_TOKEN in .env')
    return duffelProvider(token)
  }
  console.warn('[fly-with-me] no DUFFEL_TOKEN set — using deterministic fixture provider (synthetic data)')
  return fixtureProvider()
}

export * from './types.js'
