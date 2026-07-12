import { beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, TripConfigSchema, costAll, type TripConfig } from '@fwm/shared'
import { saveConfig } from '../src/config.js'
import { assembleOptions } from '../src/core/groupOptions.js'
import { synthesizeSplitTickets } from '../src/core/splitTicket.js'
import { openDb, type DB } from '../src/db/db.js'
import { executeSpec } from '../src/fetch/fetcher.js'
import { planQueries } from '../src/fetch/queryPlanner.js'
import { fixtureProvider } from '../src/providers/fixture.js'

/** Full pipeline against the deterministic fixture provider:
 *  plan -> fetch -> ingest -> group -> score -> synthesize split tickets. */
describe('pipeline (fixture provider)', () => {
  let db: DB
  let cfg: TripConfig
  const provider = fixtureProvider()

  beforeAll(async () => {
    db = openDb(':memory:')
    cfg = TripConfigSchema.parse({
      parties: [
        { id: 'DC', origins: ['WAS'], travelers: 2 },
        { id: 'SEA', origins: ['SEA'], travelers: 2 },
        { id: 'MIA', origins: ['MIA'], travelers: 1 },
      ],
      intoChina: ['PEK'],
      outOfChina: ['TFU'],
      dateRange: { start: '2026-10-09', end: '2026-10-16' },
    })
    saveConfig(db, cfg)
    for (const spec of planQueries(cfg)) {
      await executeSpec(db, provider, spec, cfg)
    }
  })

  it('runs the expected number of searches (3 parties x 4 pairs x 1x1 airports)', () => {
    const n = db.prepare(`SELECT COUNT(*) AS n FROM searches`).get() as { n: number }
    expect(n.n).toBe(12)
  })

  it('ingested itineraries respect the Friday-evening and Sunday-night filters', () => {
    const rows = db
      .prepare(
        `SELECT s.departs_local FROM segments s
         JOIN itineraries i ON i.id = s.itinerary_id
         WHERE i.kind = 'openjaw' AND s.leg = 'outbound' AND s.pos = 0`,
      )
      .all() as { departs_local: string }[]
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r.departs_local.slice(11, 16) >= '17:00').toBe(true)
  })

  it('produces complete group options where all parties share both trunks', () => {
    const options = assembleOptions(db, cfg)
    expect(options.length).toBeGreaterThan(0)
    for (const o of options) {
      expect(o.complete).toBe(true)
      expect(o.parties.map((p) => p.partyId).sort()).toEqual(['DC', 'MIA', 'SEA'])
      expect(o.totalCents).toBeGreaterThan(0)
      expect(o.metrics).not.toBeNull()
      // Door-to-door includes feeders, so it can never beat the shared trunk alone.
      expect(o.metrics!.total_travel_time).toBeGreaterThanOrEqual(o.metrics!.trunk_duration)
      expect(typeof o.gatewayOutUS).toBe('boolean')
    }
  })

  it('keeps incomplete options when asked (split-ticket candidates)', () => {
    const all = assembleOptions(db, cfg, { includeIncomplete: true })
    const incomplete = all.filter((o) => o.missingParties.length > 0)
    expect(all.length).toBeGreaterThan(assembleOptions(db, cfg).length)
    expect(incomplete.length).toBeGreaterThan(0)
  })

  it('prices complete options and finds a selective Pareto frontier', () => {
    const options = assembleOptions(db, cfg)
    const results = costAll(options, DEFAULT_PREFS)
    expect(results.every((r) => r.trueCostCents !== null)).toBe(true)
    // True cost always exceeds raw ticket cost (time is never free).
    results.forEach((r, i) => expect(r.trueCostCents!).toBeGreaterThan(options[i]!.totalCents!))
    const frontier = results.filter((r) => r.pareto).length
    expect(frontier).toBeGreaterThan(0)
    expect(frontier).toBeLessThan(options.length) // fixed 3-axis frontier stays selective
  })

  it('concurrent refreshes of the same config coalesce into one job', async () => {
    const { startRefresh, waitForJob } = await import('../src/fetch/fetcher.js')
    const specs = planQueries(cfg)
    const a = startRefresh(db, provider, cfg, specs)
    const b = startRefresh(db, provider, cfg, specs) // same config, while running
    expect(b.id).toBe(a.id)
    const done = await waitForJob(a.id)
    expect(done.status).toBe('done')
    const c = startRefresh(db, provider, cfg, specs) // after completion: a fresh job
    expect(c.id).not.toBe(a.id)
    await waitForJob(c.id)
  })

  it('trips: create, per-trip history on overwrite, restore', async () => {
    const {
      createTrip, deleteTrip, getTrip, listHistory, listTrips, loadTripConfig,
      recordHistoryBeforeOverwrite, restoreHistory, saveTripConfig,
    } = await import('../src/config.js')

    const trip = createTrip(db, 'shanghai test', { ...cfg, intoChina: ['PVG'], outOfChina: ['PEK'] })
    expect(listTrips(db).some((t) => t.id === trip.id)).toBe(true)
    expect(loadTripConfig(db, trip.id)!.intoChina).toEqual(['PVG'])

    // Overwriting logs the outgoing config to THIS trip's history.
    const modified = { ...trip.config, intoChina: ['SHA'] }
    recordHistoryBeforeOverwrite(db, trip.id, modified)
    saveTripConfig(db, trip.id, modified)
    const hist = listHistory(db, trip.id)
    expect(hist.length).toBe(1)
    expect(hist[0]!.config.intoChina).toEqual(['PVG'])

    // Restore brings it back (and logs the SHA version).
    const restored = restoreHistory(db, trip.id, hist[0]!.id)!
    expect(restored.intoChina).toEqual(['PVG'])
    expect(listHistory(db, trip.id)[0]!.config.intoChina).toEqual(['SHA'])

    // No-op overwrites don't spam history; other trips' history is untouched.
    const before = listHistory(db, trip.id).length
    recordHistoryBeforeOverwrite(db, trip.id, loadTripConfig(db, trip.id)!)
    expect(listHistory(db, trip.id).length).toBe(before)
    expect(getTrip(db, 'nonexistent')).toBeUndefined()

    deleteTrip(db, trip.id) // leave the shared fixture db as we found it
    expect(listTrips(db).some((t) => t.id === trip.id)).toBe(false)
  })

  it('solo baselines exist per party and never cost more than any group option', async () => {
    const { soloCandidates } = await import('../src/core/solo.js')
    const candidates = soloCandidates(db, cfg, 'fixture')
    const parties = [...new Set(candidates.map((c) => c.partyId))].sort()
    expect(parties).toEqual(['DC', 'MIA', 'SEA'])
    for (const c of candidates) {
      expect(c.doorMin).toBeGreaterThan(0)
      expect(c.timeQuality).toBeGreaterThanOrEqual(0)
      expect(c.timeQuality).toBeLessThanOrEqual(1)
    }
    // The unconstrained minimum ticket price is <= any group option's price for
    // the same party (group options draw from the same itinerary pool).
    const options = assembleOptions(db, cfg)
    for (const partyId of parties) {
      const soloMin = Math.min(...candidates.filter((c) => c.partyId === partyId).map((c) => c.perPersonCents))
      for (const o of options) {
        const p = o.parties.find((x) => x.partyId === partyId)
        if (p) expect(soloMin).toBeLessThanOrEqual(p.perPersonCents)
      }
    }
  })

  it('snapshots freeze config + scored results and round-trip through the DB', async () => {
    const { createSnapshot, getSnapshot, listSnapshots } = await import('../src/core/snapshots.js')
    const { scoredOptions } = await import('../src/api/routes.js')
    const { DEFAULT_PREFS: prefs } = await import('@fwm/shared')
    const options = scoredOptions(db, cfg, { provider: 'fixture', withSegments: true, top: 10 })
    const meta = createSnapshot(db, {
      name: 'test snap', provider: 'fixture', config: cfg, prefs,
      query: { top: 10 }, options,
    })
    expect(meta.url).toBe(`/s/${meta.id}`)
    const snap = getSnapshot(db, meta.id)!
    expect(snap.name).toBe('test snap')
    expect(snap.options).toHaveLength(options.length)
    expect(snap.options[0]!.parties[0]!.segments!.length).toBeGreaterThan(0) // self-contained
    expect(snap.config.parties.map((p) => p.id)).toEqual(['DC', 'SEA', 'MIA'])
    expect(listSnapshots(db).some((s) => s.id === meta.id)).toBe(true)
  })

  it('synthesizes split tickets so an incomplete option becomes priceable', async () => {
    const incomplete = assembleOptions(db, cfg, { includeIncomplete: true }).filter(
      (o) => o.missingParties.length > 0,
    )
    let succeeded = false
    for (const o of incomplete) {
      const { option, reports } = await synthesizeSplitTickets(db, provider, cfg, o.id)
      if (option && option.missingParties.length === 0 && reports.every((r) => r.ok)) {
        expect(option.splitParties.length).toBeGreaterThan(0)
        expect(option.totalCents).toBeGreaterThan(0)
        expect(option.metrics).not.toBeNull()
        expect(option.flags).toContain('split_ticket')
        const split = option.splitTickets[0]!
        expect(split.bufferOutMin).toBeGreaterThanOrEqual(cfg.minSelfTransferMin)
        expect(split.bufferBackMin).toBeGreaterThanOrEqual(cfg.minSelfTransferMin)
        expect(split.flags).toContain('self_transfer_risk')
        succeeded = true
        break
      }
    }
    expect(succeeded).toBe(true)
  })
})
