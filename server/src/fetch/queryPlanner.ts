import type { TripConfig } from '@fwm/shared'
import type { SearchParams } from '../providers/types.js'
import { deriveDatePairs } from './datePairs.js'

export interface SearchSpec {
  kind: 'openjaw' | 'trunk_only' | 'positioning'
  partyId: string
  /** For positioning searches: which end of the trip this covers. */
  posDirection?: 'out' | 'back'
  depDate: string
  retDate?: string
  params: SearchParams
}

/** The deterministic full sweep for the current config: one open-jaw search per
 *  party-origin x date-pair x (intoChina x outOfChina) combination. */
export function planQueries(cfg: TripConfig): SearchSpec[] {
  const specs: SearchSpec[] = []
  for (const party of cfg.parties) {
    for (const origin of party.origins) {
      for (const pair of deriveDatePairs(cfg)) {
        for (const into of cfg.intoChina) {
          for (const outOf of cfg.outOfChina) {
            specs.push({
              kind: 'openjaw',
              partyId: party.id,
              depDate: pair.depart,
              retDate: pair.ret,
              params: {
                slices: [
                  {
                    origin,
                    destination: into,
                    departureDate: pair.depart,
                    departAfterLocal: cfg.departAfterLocal,
                  },
                  { origin: outOf, destination: origin, departureDate: pair.ret },
                ],
                travelers: party.travelers,
                cabin: cfg.cabin,
                maxConnections: cfg.maxConnections,
              },
            })
          }
        }
      }
    }
  }
  return specs
}
