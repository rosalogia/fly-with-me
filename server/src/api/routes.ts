import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import {
  DEFAULT_CONFIG, TripConfigSchema, costAll, parsePrefsParam,
  type CacheStatsDto, type ScoredOptionDto, type TripConfig,
} from '@fwm/shared'
import {
  MAIN_TRIP, createTrip, deleteTrip, getTrip, listHistory, listTrips, loadTripConfig,
  migrateToTrips, recordHistoryBeforeOverwrite, renameTrip, restoreHistory, saveTripConfig,
} from '../config.js'
import { assembleOptions, findOption } from '../core/groupOptions.js'
import { createSnapshot, getSnapshot, listSnapshots } from '../core/snapshots.js'
import { soloCandidates } from '../core/solo.js'
import { synthesizeSplitTickets } from '../core/splitTicket.js'
import type { DB } from '../db/db.js'
import { deriveDatePairs } from '../fetch/datePairs.js'
import { getJob, specHash, startRefresh } from '../fetch/fetcher.js'
import { planQueries } from '../fetch/queryPlanner.js'
import type { FlightProvider } from '../providers/types.js'

export interface AppDeps {
  db: DB
  provider: FlightProvider
}

export function scoredOptions(
  db: DB,
  cfg: TripConfig,
  query: {
    /** Dollar preferences, e.g. "hourly:20,risk:300,hotel:150,fairness:0,odd:50". */
    prefs?: string | null
    includeIncomplete?: boolean
    sort?: string | null
    top?: number | null
    provider?: string
    /** 'us' = both gateways in the US; 'nonus' = at least one foreign gateway. */
    gateways?: string | null
    /** Attach full segment lists (used by snapshots so they're self-contained). */
    withSegments?: boolean
  },
): ScoredOptionDto[] {
  const prefs = parsePrefsParam(query.prefs)
  let options = assembleOptions(db, cfg, {
    includeIncomplete: query.includeIncomplete ?? false,
    provider: query.provider,
    withSegments: query.withSegments,
  })
  if (query.gateways === 'us') options = options.filter((o) => o.gatewayOutUS && o.gatewayInUS)
  else if (query.gateways === 'nonus') options = options.filter((o) => !(o.gatewayOutUS && o.gatewayInUS))
  const scoring = costAll(options, prefs)
  let scored: ScoredOptionDto[] = options.map((o, i) => ({ ...o, ...scoring[i]! }))

  const sort = query.sort ?? 'cost'
  const cmpNullsLast = (a: number | null, b: number | null, dir: 1 | -1) => {
    if (a == null && b == null) return 0
    if (a == null) return 1
    if (b == null) return -1
    return (a - b) * dir
  }
  const comparators: Record<string, (a: ScoredOptionDto, b: ScoredOptionDto) => number> = {
    cost: (a, b) => cmpNullsLast(a.trueCostCents, b.trueCostCents, 1),
    cash: (a, b) => cmpNullsLast(a.cashCents, b.cashCents, 1),
    total: (a, b) => cmpNullsLast(a.totalCents, b.totalCents, 1),
    fairness: (a, b) => cmpNullsLast(a.metrics?.fairness ?? null, b.metrics?.fairness ?? null, 1),
    duration: (a, b) => cmpNullsLast(a.metrics?.trunk_duration ?? null, b.metrics?.trunk_duration ?? null, 1),
    total_time: (a, b) => cmpNullsLast(a.metrics?.total_travel_time ?? null, b.metrics?.total_travel_time ?? null, 1),
    per_person_max: (a, b) => cmpNullsLast(a.perPersonMaxCents, b.perPersonMaxCents, 1),
  }
  scored.sort(comparators[sort] ?? comparators.cost!)
  if (query.top && query.top > 0) scored = scored.slice(0, query.top)
  return scored
}

const AGENT_GUIDE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'agent-guide.md'),
  'utf8',
)

/** Absolute base URL as the client sees it (tunnel-aware via forwarded headers). */
export function baseUrl(c: Context): string {
  const proto = c.req.header('x-forwarded-proto') ?? 'http'
  const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? 'localhost:3000'
  return `${proto}://${host}`
}

/** When the request authenticated via ?key=, propagate it into generated links so
 *  fetch-only agents (no headers, can only follow URLs they've seen) can navigate. */
function linkifier(c: Context): (path: string) => string {
  const base = baseUrl(c)
  const key = c.req.query('key')
  return (path: string) => {
    const url = `${base}${path}`
    if (!key) return url
    return url + (url.includes('?') ? '&' : '?') + `key=${encodeURIComponent(key)}`
  }
}

export function buildApp(deps: AppDeps): Hono {
  const { db, provider } = deps
  migrateToTrips(db)
  const app = new Hono()
  app.use('/api/*', cors())

  // Task-oriented guide for AI agents (llms.txt convention). Appends a
  // per-request block of READY-TO-FETCH absolute URLs (key included when used),
  // because some agents can only follow URLs they've literally seen.
  const serveGuide = (c: Context) => {
    const link = linkifier(c)
    const trips = listTrips(db)
    const ready = [
      '',
      '## Ready-to-fetch URLs (absolute, auth included — follow these instead of building your own)',
      '',
      `- Endpoint index: ${link('/api')}`,
      `- All searches: ${link('/api/trips')}`,
      ...trips.flatMap((t) => [
        `- "${t.name}" options (scored): ${link(`/api/trips/${t.id}/options?top=15`)}`,
        `- "${t.name}" config: ${link(`/api/trips/${t.id}/config`)}`,
        `- "${t.name}" fly-alone baselines: ${link(`/api/trips/${t.id}/solo`)}`,
        `- "${t.name}" cache/query budget: ${link(`/api/trips/${t.id}/cache/stats`)}`,
      ]),
      `- Snapshots: ${link('/api/snapshots')}`,
      '',
      'Option-detail and snapshot URLs are included inside those responses (follow the',
      '`href` fields). If your platform supports MCP connectors, prefer adding this',
      `server as a connector instead: ${link('/mcp')}`,
      '',
    ].join('\n')
    return c.text(AGENT_GUIDE + ready, 200, { 'Content-Type': 'text/markdown; charset=utf-8' })
  }
  app.get('/llms.txt', serveGuide)
  app.get('/api/guide', serveGuide)

  // Self-describing index so an AI agent (or a curious human) pointed at this
  // server can discover the whole surface without any out-of-band docs.
  app.get('/api', (c) =>
    c.json({
      name: 'fly-with-me',
      description:
        'Group flight search: parties from different US cities share identical "trunk" flights into and out of China. Every search is a TRIP with its own id and URL (/t/<id>); the provider cache is shared across trips. Options are priced as generalized cost in dollars and presented as deltas vs the best option.',
      endpoints: [
        { method: 'GET', path: '/api/trips', doc: 'All searches (trips): id, name, config, timestamps.' },
        { method: 'POST', path: '/api/trips', doc: 'Body {name, config?, cloneFrom?}. Start a new search — config explicit, cloned from another trip id, or the default template. Returns the trip; its UI lives at /t/<id>.' },
        { method: 'GET', path: '/api/trips/:tid', doc: 'Trip meta + config.' },
        { method: 'PATCH', path: '/api/trips/:tid', doc: 'Body {name}. Rename.' },
        { method: 'DELETE', path: '/api/trips/:tid', doc: "Delete a trip (the group's shared 'main' trip cannot be deleted)." },
        { method: 'GET', path: '/api/trips/:tid/config', doc: 'Trip config.' },
        { method: 'PUT', path: '/api/trips/:tid/config', doc: 'Replace trip config (zod-validated). The outgoing version is appended to that trip\'s history automatically.' },
        { method: 'GET', path: '/api/trips/:tid/config/history', doc: 'Recent overwritten versions (capped 50). POST /api/trips/:tid/config/history/:hid/restore to bring one back.' },
        { method: 'GET', path: '/api/trips/:tid/date-pairs', doc: 'Derived (depart, return) date pairs.' },
        { method: 'POST', path: '/api/trips/:tid/refresh', doc: 'Body {force?:bool}. Start the provider sweep for this trip -> job {id}. Cache-aware and shared across trips; do not loop forced refreshes.' },
        { method: 'GET', path: '/api/refresh/:jobId', doc: 'Poll job progress (jobs are global).' },
        { method: 'GET', path: '/api/trips/:tid/options', doc: 'Scored group options. Params: prefs=hourly:20,risk:300,hotel:150,fairness:0,odd:50 (all dollars) · gateways=us|nonus · includeIncomplete=1 · top=N · sort=cost|cash|total|fairness|duration|total_time|per_person_max. Fields: cashCents (real money), benchmark, deltaVsBestCents + deltaBreakdown (vs the benchmark — show these to humans, not trueCostCents), pareto (frontier over cash/person-time/spread).' },
        { method: 'GET', path: '/api/trips/:tid/options/:id', doc: 'Full option detail incl. per-party segments. Structural only — pricing fields come from the options list (they depend on prefs and the full result set).' },
        { method: 'POST', path: '/api/trips/:tid/options/:id/synthesize', doc: 'Price split tickets (positioning + trunk-only) for parties missing from this option. ~3-6 live searches.' },
        { method: 'GET', path: '/api/trips/:tid/trunks', doc: 'Distinct trunk pairs with party coverage.' },
        { method: 'GET', path: '/api/trips/:tid/solo', doc: 'Per-party fly-alone baselines (same cached data, no group constraint). Pick per prefs: gc = perPersonCents + hourly*(doorMin/60) + (1-timeQuality)*odd.' },
        { method: 'GET', path: '/api/trips/:tid/cache/stats', doc: 'Cache freshness + this trip\'s query budget: estimatedFullRefreshQueries vs cachedQueries (the cost preview for experiments).' },
        { method: 'POST', path: '/api/trips/:tid/snapshots', doc: 'Body {name?, prefs?, gateways?, includeIncomplete?, top? (default 100; 0 = config-only share)}. Freeze this trip\'s config + scored results at /s/<id>. Snapshots never change and cannot be deleted over HTTP.' },
        { method: 'GET', path: '/api/snapshots', doc: 'List snapshots (global).' },
        { method: 'GET', path: '/api/snapshots/:id', doc: 'Full frozen snapshot (config, prefs, options incl. segments, solo baselines).' },
        { method: 'GET', path: '/api/… (legacy)', doc: "The old un-scoped endpoints (/api/config, /api/options, /api/refresh, /api/solo, /api/trunks, /api/cache/stats, /api/snapshots POST, /api/config/history) still work and operate on the 'main' trip." },
      ],
      notes: [
        'START HERE if you are an AI agent: GET /llms.txt — a task-oriented guide (recipes, etiquette, field semantics) for helping a human with this service.',
        'Source code: https://github.com/rosalogia/fly-with-me — read it to verify exact scoring/matching behavior.',
        'Auth: HTTP basic (user "group") when SHARE_PASSWORD is set.',
        'deltaBreakdown has SIX component fields (tickets/hotel/risk/time/oddHours/fairness) that sum to deltaVsBestCents, PLUS a totalCents field equal to that sum — do not add totalCents when summing components.',
        'Share links: <base-url>/s/<snapshot-id> (frozen results) and <base-url>/t/<trip-id> (live search).',
        'Prefer starting your own trip (POST /api/trips, cloneFrom:"main") over editing someone else\'s — the cache is shared, so clones are cheap.',
        'Trunk = the flights everyone shares; "2 tickets"/split options carry self-transfer risk, priced via the risk pref.',
        'Prices are live bookable fares at fetch time and move constantly — snapshot before sharing conclusions.',
      ],
    }),
  )

  // ---- trips CRUD ----

  app.get('/api/trips', (c) => {
    const link = linkifier(c)
    return c.json(
      listTrips(db).map((t) => ({
        ...t,
        href: {
          page: link(`/t/${t.id}`),
          options: link(`/api/trips/${t.id}/options?top=15`),
          config: link(`/api/trips/${t.id}/config`),
          solo: link(`/api/trips/${t.id}/solo`),
          stats: link(`/api/trips/${t.id}/cache/stats`),
        },
      })),
    )
  })

  app.post('/api/trips', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string
      config?: unknown
      cloneFrom?: string
    }
    let config: TripConfig
    if (body.config) {
      const parsed = TripConfigSchema.safeParse(body.config)
      if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)
      config = parsed.data
    } else if (body.cloneFrom) {
      const src = loadTripConfig(db, body.cloneFrom)
      if (!src) return c.json({ error: `unknown trip ${body.cloneFrom}` }, 404)
      config = src
    } else {
      config = DEFAULT_CONFIG
    }
    return c.json(createTrip(db, body.name ?? 'Untitled search', config), 201)
  })

  app.get('/api/trips/:tid', (c) => {
    const trip = getTrip(db, c.req.param('tid')!)
    return trip ? c.json(trip) : c.json({ error: 'unknown trip' }, 404)
  })

  app.patch('/api/trips/:tid', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string }
    if (!body.name?.trim()) return c.json({ error: 'name required' }, 400)
    return renameTrip(db, c.req.param('tid')!, body.name)
      ? c.json(getTrip(db, c.req.param('tid')!))
      : c.json({ error: 'unknown trip' }, 404)
  })

  app.delete('/api/trips/:tid', (c) => {
    const tid = c.req.param('tid')!
    if (tid === MAIN_TRIP) return c.json({ error: "the shared 'main' trip cannot be deleted" }, 403)
    return deleteTrip(db, tid) ? c.json({ ok: true }) : c.json({ error: 'unknown trip' }, 404)
  })

  // ---- trip-scoped handlers, mounted at /api/trips/:tid/* and as legacy /api/* on 'main' ----

  type TripHandler = (c: Context, tripId: string, cfg: TripConfig) => Response | Promise<Response>

  const forTrip =
    (handler: TripHandler, tripParam: boolean) =>
    (c: Context): Response | Promise<Response> => {
      const tripId = tripParam ? c.req.param('tid')! : MAIN_TRIP
      const cfg = loadTripConfig(db, tripId)
      if (!cfg) return c.json({ error: 'unknown trip' }, 404)
      return handler(c, tripId, cfg)
    }

  const mount = (
    method: 'get' | 'post' | 'put',
    subPath: string,
    handler: TripHandler,
  ) => {
    app[method](`/api/trips/:tid${subPath}`, forTrip(handler, true))
    app[method](`/api${subPath}`, forTrip(handler, false))
  }

  mount('get', '/config', (c, _tid, cfg) => c.json(cfg))

  mount('put', '/config', async (c, tid) => {
    const parsed = TripConfigSchema.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)
    recordHistoryBeforeOverwrite(db, tid, parsed.data)
    saveTripConfig(db, tid, parsed.data)
    return c.json(parsed.data)
  })

  mount('get', '/config/history', (c, tid) => c.json(listHistory(db, tid)))

  mount('post', '/config/history/:hid/restore', (c, tid) => {
    const cfg = restoreHistory(db, tid, Number(c.req.param('hid')!))
    return cfg ? c.json(cfg) : c.json({ error: 'unknown history entry' }, 404)
  })

  mount('get', '/date-pairs', (c, _tid, cfg) => c.json(deriveDatePairs(cfg)))

  mount('post', '/refresh', async (c, _tid, cfg) => {
    const body = (await c.req.json().catch(() => ({}))) as { force?: boolean }
    const specs = planQueries(cfg)
    // Live Duffel enforces per-minute rate limits: single-file with generous spacing.
    const gentle = provider.name !== 'fixture'
    const job = startRefresh(db, provider, cfg, specs, {
      force: body.force,
      concurrency: gentle ? 1 : 4,
      spacingMs: gentle ? 1100 : 0,
    })
    return c.json(job, 202)
  })

  app.get('/api/refresh/:jobId', (c) => {
    const job = getJob(c.req.param('jobId')!)
    return job ? c.json(job) : c.json({ error: 'unknown job' }, 404)
  })

  mount('get', '/options', (c, tid, cfg) => {
    const link = linkifier(c)
    const options = scoredOptions(db, cfg, {
      prefs: c.req.query('prefs'),
      includeIncomplete: c.req.query('includeIncomplete') === '1',
      sort: c.req.query('sort'),
      top: c.req.query('top') ? Number(c.req.query('top')) : null,
      provider: provider.name,
      gateways: c.req.query('gateways'),
    })
    return c.json(options.map((o) => ({ ...o, href: link(`/api/trips/${tid}/options/${o.id}`) })))
  })

  mount('get', '/options/:id', (c, _tid, cfg) => {
    const option = findOption(db, cfg, c.req.param('id')!, true, provider.name)
    return option ? c.json(option) : c.json({ error: 'unknown option' }, 404)
  })

  mount('post', '/options/:id/synthesize', async (c, _tid, cfg) => {
    const result = await synthesizeSplitTickets(db, provider, cfg, c.req.param('id')!)
    if (!result.option) return c.json({ error: 'unknown option' }, 404)
    return c.json(result)
  })

  mount('get', '/trunks', (c, _tid, cfg) => {
    const options = assembleOptions(db, cfg, { includeIncomplete: true, provider: provider.name })
    return c.json(
      options.map((o) => ({
        id: o.id,
        outboundTrunkKey: o.outboundTrunkKey,
        returnTrunkKey: o.returnTrunkKey,
        gatewayOut: o.gatewayOut,
        gatewayIn: o.gatewayIn,
        departDate: o.departDate,
        returnDate: o.returnDate,
        coveredParties: o.parties.map((p) => p.partyId),
        splitParties: o.splitParties,
        missingParties: o.missingParties,
      })),
    )
  })

  mount('get', '/solo', (c, _tid, cfg) => c.json(soloCandidates(db, cfg, provider.name)))

  mount('get', '/cache/stats', (c, _tid, cfg) => {
    const counts = db
      .prepare(
        `SELECT COUNT(*) AS searches,
                SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok,
                SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS err,
                MAX(fetched_at) AS last
         FROM searches`,
      )
      .get() as { searches: number; ok: number | null; err: number | null; last: string | null }
    const itins = db.prepare(`SELECT COUNT(*) AS n FROM itineraries`).get() as { n: number }
    const specs = planQueries(cfg)
    const hashStmt = db.prepare(
      `SELECT 1 FROM searches WHERE params_hash = ? AND status IN ('ok','empty') LIMIT 1`,
    )
    const cachedQueries = specs.filter((s) => hashStmt.get(specHash(provider.name, s))).length
    const stats: CacheStatsDto = {
      searches: counts.searches,
      okSearches: counts.ok ?? 0,
      errorSearches: counts.err ?? 0,
      itineraries: itins.n,
      lastFetchedAt: counts.last,
      estimatedFullRefreshQueries: specs.length,
      cachedQueries,
    }
    return c.json(stats)
  })

  mount('post', '/snapshots', async (c, _tid, cfg) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string
      prefs?: string
      gateways?: string
      includeIncomplete?: boolean
      top?: number
    }
    const query = {
      gateways: body.gateways ?? null,
      includeIncomplete: body.includeIncomplete ?? false,
      top: body.top ?? 100,
    }
    // top: 0 = a config-only share (no results, no solo baselines attached).
    const configOnly = query.top === 0
    const options = configOnly
      ? []
      : scoredOptions(db, cfg, {
          prefs: body.prefs,
          includeIncomplete: query.includeIncomplete,
          gateways: query.gateways,
          top: query.top,
          provider: provider.name,
          withSegments: true,
        })
    const meta = createSnapshot(db, {
      name: body.name,
      provider: provider.name,
      config: cfg,
      prefs: parsePrefsParam(body.prefs),
      query,
      options,
      solo: configOnly ? [] : soloCandidates(db, cfg, provider.name),
    })
    return c.json({ ...meta, shareUrl: `${baseUrl(c)}${meta.url}` }, 201)
  })

  app.get('/api/snapshots', (c) =>
    c.json(listSnapshots(db).map((s) => ({ ...s, shareUrl: `${baseUrl(c)}${s.url}` }))),
  )

  app.get('/api/snapshots/:id', (c) => {
    const snap = getSnapshot(db, c.req.param('id')!)
    return snap ? c.json(snap) : c.json({ error: 'unknown snapshot' }, 404)
  })

  // Snapshots are deliberately NOT deletable over HTTP — shared links keep
  // working. Local owner cleanup: fwm sql "DELETE FROM snapshots WHERE id='…'".

  return app
}
