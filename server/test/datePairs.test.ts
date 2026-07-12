import { describe, expect, it } from 'vitest'
import { TripConfigSchema } from '@fwm/shared'
import { deriveDatePairs } from '../src/fetch/datePairs.js'
import { sundayDeadline } from '../src/core/time.js'

const base = {
  parties: [{ id: 'DC', origins: ['WAS'], travelers: 2 }],
  intoChina: ['PEK'],
  outOfChina: ['TFU'],
}

describe('deriveDatePairs', () => {
  it('finds all Fridays in October 2026 with Sat/Sun returns', () => {
    const cfg = TripConfigSchema.parse({ ...base, dateRange: { start: '2026-10-01', end: '2026-10-31' } })
    const pairs = deriveDatePairs(cfg)
    const departures = [...new Set(pairs.map((p) => p.depart))]
    expect(departures).toEqual(['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30'])
    expect(pairs).toHaveLength(10) // each Friday: +15 (Sat) and +16 (Sun)
  })

  it('crosses month boundaries on the return date', () => {
    const cfg = TripConfigSchema.parse({ ...base, dateRange: { start: '2026-10-30', end: '2026-10-30' } })
    const pairs = deriveDatePairs(cfg)
    expect(pairs).toEqual([
      { depart: '2026-10-30', ret: '2026-11-14' },
      { depart: '2026-10-30', ret: '2026-11-15' },
    ])
  })

  it('respects returnDow restrictions', () => {
    const cfg = TripConfigSchema.parse({
      ...base,
      dateRange: { start: '2026-10-09', end: '2026-10-09' },
      returnDow: [6], // Saturday only
    })
    expect(deriveDatePairs(cfg)).toEqual([{ depart: '2026-10-09', ret: '2026-10-24' }])
  })
})

describe('sundayDeadline', () => {
  it('Saturday return -> next day Sunday night', () => {
    expect(sundayDeadline('2026-10-24')).toBe('2026-10-25T23:59:59')
  })
  it('Sunday return -> same day night', () => {
    expect(sundayDeadline('2026-10-25')).toBe('2026-10-25T23:59:59')
  })
  it('mid-week return -> upcoming Sunday', () => {
    expect(sundayDeadline('2026-10-21')).toBe('2026-10-25T23:59:59')
  })
})
