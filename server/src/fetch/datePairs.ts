import type { TripConfig } from '@fwm/shared'
import type { DatePair } from '@fwm/shared'
import { addDays, dayOfWeek } from '../core/time.js'

/**
 * Enumerate (departure, return) date pairs: departure days matching departDow
 * within the range, return = departure + tripLenDays filtered to returnDow.
 * Departures are bounded by the range; returns may extend past range.end.
 */
export function deriveDatePairs(cfg: TripConfig): DatePair[] {
  const pairs: DatePair[] = []
  for (let d = cfg.dateRange.start; d <= cfg.dateRange.end; d = addDays(d, 1)) {
    if (dayOfWeek(d) !== cfg.departDow) continue
    for (const len of cfg.tripLenDays) {
      const ret = addDays(d, len)
      if (cfg.returnDow.includes(dayOfWeek(ret))) pairs.push({ depart: d, ret })
    }
  }
  return pairs
}
