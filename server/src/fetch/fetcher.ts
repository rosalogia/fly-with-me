import { createHash, randomUUID } from 'node:crypto'
import type { RefreshJobDto, TripConfig } from '@fwm/shared'
import { airportTz } from '../airports.js'
import { outboundTrunkSegs, returnTrunkSegs, trunkKey } from '../core/trunk.js'
import { sundayDeadline } from '../core/time.js'
import type { DB } from '../db/db.js'
import type { FlightProvider, ProviderOffer, ProviderSegment } from '../providers/types.js'
import type { SearchSpec } from './queryPlanner.js'

export function specHash(providerName: string, spec: SearchSpec): string {
  const canonical = JSON.stringify({ provider: providerName, kind: spec.kind, params: spec.params })
  return createHash('sha256').update(canonical).digest('hex')
}

function resolveTz(seg: ProviderSegment, which: 'origin' | 'dest'): string | null {
  const provided = which === 'origin' ? seg.originTz : seg.destTz
  return provided ?? airportTz(which === 'origin' ? seg.origin : seg.destination)
}

interface NormalizedSeg {
  carrier: string
  flightNumber: string
  operatingCarrier: string | null
  origin: string
  destination: string
  departsLocal: string
  arrivesLocal: string
  originTz: string
  destTz: string
  durationMin: number | null
  aircraft: string | null
}

function normalizeSlice(slice: ProviderSegment[]): NormalizedSeg[] | null {
  const out: NormalizedSeg[] = []
  for (const s of slice) {
    const originTz = resolveTz(s, 'origin')
    const destTz = resolveTz(s, 'dest')
    if (!originTz || !destTz) return null // unknown airport tz — can't classify regions safely
    out.push({ ...s, originTz, destTz })
  }
  return out
}

const insertItinerary = (db: DB) =>
  db.prepare(`
    INSERT INTO itineraries (search_id, party_id, kind, provider_offer_id, dep_date, ret_date,
      travelers, total_cents, currency, per_person_cents, outbound_trunk_key, return_trunk_key, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

const insertSegment = (db: DB) =>
  db.prepare(`
    INSERT INTO segments (itinerary_id, leg, pos, carrier, flight_number, operating_carrier,
      origin, destination, departs_local, arrives_local, origin_tz, dest_tz, duration_min, aircraft, is_trunk)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

function insertSegments(
  db: DB,
  itinId: number | bigint,
  leg: 'outbound' | 'return',
  segs: NormalizedSeg[],
  trunkSet: Set<NormalizedSeg>,
) {
  const stmt = insertSegment(db)
  segs.forEach((s, pos) => {
    stmt.run(
      itinId, leg, pos, s.carrier, s.flightNumber, s.operatingCarrier,
      s.origin, s.destination, s.departsLocal, s.arrivesLocal,
      s.originTz, s.destTz, s.durationMin, s.aircraft, trunkSet.has(s) ? 1 : 0,
    )
  })
}

/** Ingest provider offers for one executed search. Returns count of stored itineraries. */
export function ingestOffers(
  db: DB,
  searchId: number | bigint,
  spec: SearchSpec,
  offers: ProviderOffer[],
  cfg: TripConfig,
): number {
  const itinStmt = insertItinerary(db)
  let stored = 0

  for (const offer of offers) {
    if (spec.kind === 'openjaw' || spec.kind === 'trunk_only') {
      if (offer.slices.length !== 2) continue
      const outSegs = normalizeSlice(offer.slices[0]!)
      const retSegs = normalizeSlice(offer.slices[1]!)
      if (!outSegs || !retSegs || outSegs.length === 0 || retSegs.length === 0) continue

      const outTrunk = outboundTrunkSegs(outSegs)
      const retTrunk = returnTrunkSegs(retSegs)
      if (!outTrunk || !retTrunk) continue

      if (spec.kind === 'openjaw') {
        // Hard filters: leave home after departAfterLocal; home by Sunday night.
        if (outSegs[0]!.departsLocal.slice(11, 16) < cfg.departAfterLocal) continue
        const finalArrival = retSegs[retSegs.length - 1]!.arrivesLocal
        if (finalArrival > sundayDeadline(spec.retDate!)) continue
      }

      const kind = spec.kind === 'openjaw' ? 'openjaw' : 'trunk_only'
      const perPerson = Math.round(offer.totalAmountCents / spec.params.travelers)
      const res = itinStmt.run(
        searchId, spec.partyId, kind, offer.offerId, spec.depDate, spec.retDate ?? null,
        spec.params.travelers, offer.totalAmountCents, offer.currency, perPerson,
        trunkKey(outTrunk), trunkKey(retTrunk), JSON.stringify(offer),
      )
      const trunkSet = new Set<NormalizedSeg>([...outTrunk, ...retTrunk])
      insertSegments(db, res.lastInsertRowid, 'outbound', outSegs, trunkSet)
      insertSegments(db, res.lastInsertRowid, 'return', retSegs, trunkSet)
      stored++
    } else {
      // positioning: single slice, no trunk keys
      if (offer.slices.length !== 1) continue
      const segs = normalizeSlice(offer.slices[0]!)
      if (!segs || segs.length === 0) continue
      const kind = spec.posDirection === 'back' ? 'positioning_back' : 'positioning_out'
      const leg = spec.posDirection === 'back' ? 'return' : 'outbound'
      const perPerson = Math.round(offer.totalAmountCents / spec.params.travelers)
      const res = itinStmt.run(
        searchId, spec.partyId, kind, offer.offerId, spec.depDate, spec.retDate ?? null,
        spec.params.travelers, offer.totalAmountCents, offer.currency, perPerson,
        null, null, JSON.stringify(offer),
      )
      insertSegments(db, res.lastInsertRowid, leg, segs, new Set())
      stored++
    }
  }
  return stored
}

export interface ExecResult {
  cached: boolean
  status: 'ok' | 'error' | 'empty'
  stored: number
  error?: string
}

/** Execute one search spec with cache-hit skipping; prunes older results for the same params. */
export async function executeSpec(
  db: DB,
  provider: FlightProvider,
  spec: SearchSpec,
  cfg: TripConfig,
  opts: { force?: boolean } = {},
): Promise<ExecResult> {
  const hash = specHash(provider.name, spec)
  if (!opts.force) {
    const existing = db
      .prepare(
        `SELECT id, status FROM searches WHERE params_hash = ? AND status IN ('ok','empty') ORDER BY fetched_at DESC LIMIT 1`,
      )
      .get(hash) as { id: number; status: string } | undefined
    if (existing) return { cached: true, status: existing.status as 'ok' | 'empty', stored: 0 }
  }

  let offers: ProviderOffer[]
  try {
    offers = await provider.search(spec.params)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    db.prepare(
      `INSERT INTO searches (provider, kind, params_hash, params_json, fetched_at, status, error) VALUES (?, ?, ?, ?, ?, 'error', ?)`,
    ).run(provider.name, spec.kind, hash, JSON.stringify(spec.params), new Date().toISOString(), msg)
    return { cached: false, status: 'error', stored: 0, error: msg }
  }

  const status = offers.length === 0 ? 'empty' : 'ok'
  const tx = db.transaction(() => {
    // Replace older results for the same query.
    db.prepare(`DELETE FROM searches WHERE params_hash = ?`).run(hash)
    const res = db
      .prepare(
        `INSERT INTO searches (provider, kind, params_hash, params_json, fetched_at, status, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        provider.name, spec.kind, hash, JSON.stringify(spec.params),
        new Date().toISOString(), status, JSON.stringify(offers).slice(0, 4_000_000),
      )
    return ingestOffers(db, res.lastInsertRowid, spec, offers, cfg)
  })
  const stored = tx()
  return { cached: false, status, stored }
}

// ---------------- refresh jobs ----------------

const jobs = new Map<string, RefreshJobDto>()

/** Coalescing: one running job per (provider, config) — a second identical
 *  request (e.g. two people pressing Refresh) joins the existing job instead
 *  of doubling the provider request rate. */
const activeByKey = new Map<string, string>()

export function getJob(id: string): RefreshJobDto | undefined {
  return jobs.get(id)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Run specs with bounded concurrency; returns immediately with a trackable job. */
export function startRefresh(
  db: DB,
  provider: FlightProvider,
  cfg: TripConfig,
  specs: SearchSpec[],
  opts: { force?: boolean; concurrency?: number; spacingMs?: number } = {},
): RefreshJobDto {
  const coalesceKey = createHash('sha256')
    .update(`${provider.name}|${JSON.stringify(cfg)}`)
    .digest('hex')
  const activeId = activeByKey.get(coalesceKey)
  if (activeId) {
    const active = jobs.get(activeId)
    if (active && active.status === 'running') return active
  }

  const job: RefreshJobDto = {
    id: randomUUID(),
    status: 'running',
    total: specs.length,
    done: 0,
    skippedCacheHits: 0,
    errors: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
  }
  jobs.set(job.id, job)
  activeByKey.set(coalesceKey, job.id)

  const queue = [...specs]
  const spacing = opts.spacingMs ?? (provider.name === 'fixture' ? 0 : 500)

  const worker = async () => {
    for (;;) {
      const spec = queue.shift()
      if (!spec) return
      let touchedNetwork = true
      try {
        const res = await executeSpec(db, provider, spec, cfg, { force: opts.force })
        touchedNetwork = !res.cached
        if (res.cached) job.skippedCacheHits++
        if (res.status === 'error') {
          job.errors.push(`${spec.kind} ${spec.partyId} ${spec.depDate}: ${res.error}`)
        }
      } catch (e) {
        job.errors.push(`${spec.kind} ${spec.partyId} ${spec.depDate}: ${e instanceof Error ? e.message : e}`)
      }
      job.done++
      // Spacing protects the provider's rate limit — cache hits never touch the
      // provider, so they complete instantly instead of paying the pacing tax.
      if (spacing && touchedNetwork && queue.length) await sleep(spacing)
    }
  }

  const n = Math.max(1, opts.concurrency ?? 2)
  void Promise.all(Array.from({ length: n }, worker)).then(() => {
    job.status = job.errors.length === job.total && job.total > 0 ? 'error' : 'done'
    job.finishedAt = new Date().toISOString()
    if (activeByKey.get(coalesceKey) === job.id) activeByKey.delete(coalesceKey)
  })

  return job
}

/** Await a job's completion (used by the CLI). */
export async function waitForJob(id: string, pollMs = 200): Promise<RefreshJobDto> {
  for (;;) {
    const job = jobs.get(id)
    if (!job) throw new Error(`unknown job ${id}`)
    if (job.status !== 'running') return job
    await sleep(pollMs)
  }
}
