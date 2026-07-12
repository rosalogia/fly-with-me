import type { IncomingMessage, ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { DEFAULT_CONFIG, TripConfigSchema, parsePrefsParam } from '@fwm/shared'
import {
  createTrip, getTrip, listTrips, loadTripConfig, recordHistoryBeforeOverwrite, saveTripConfig,
} from '../config.js'
import { findOption } from '../core/groupOptions.js'
import { createSnapshot, listSnapshots } from '../core/snapshots.js'
import { soloCandidates } from '../core/solo.js'
import { synthesizeSplitTickets } from '../core/splitTicket.js'
import type { DB } from '../db/db.js'
import { getJob, specHash, startRefresh } from '../fetch/fetcher.js'
import { planQueries } from '../fetch/queryPlanner.js'
import type { FlightProvider } from '../providers/types.js'
import { scoredOptions } from './routes.js'

const json = (x: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(x, null, 1) }] })

function buildMcp(db: DB, provider: FlightProvider, publicBase: string): McpServer {
  const mcp = new McpServer({ name: 'fly-with-me', version: '1.0.0' })

  const requireCfg = (tripId: string) => {
    const cfg = loadTripConfig(db, tripId)
    if (!cfg) throw new Error(`unknown trip "${tripId}" — call list_trips`)
    return cfg
  }

  mcp.registerTool(
    'list_trips',
    {
      description:
        'All searches ("trips"): id, name, config summary. The group\'s shared search has id "main". Start here.',
      inputSchema: {},
    },
    async () => json(listTrips(db).map((t) => ({ id: t.id, name: t.name, updatedAt: t.updatedAt, config: t.config, pageUrl: `${publicBase}/t/${t.id}` }))),
  )

  mcp.registerTool(
    'get_options',
    {
      description:
        'Scored group-travel options for a trip. Present cash (real money) and deltaVsBest ("picking this over the best effectively costs +$X") — NEVER trueCostCents as a price (it includes dollar-valued travel time). All money in integer cents. prefs are dollar exchange-rates, e.g. "hourly:20,risk:300,hotel:150,fairness:0,odd:50".',
      inputSchema: {
        tripId: z.string().default('main'),
        prefs: z.string().optional(),
        gateways: z.enum(['us', 'nonus']).optional().describe('us = group meets at a US airport'),
        includeIncomplete: z.boolean().optional(),
        top: z.number().int().min(1).max(200).default(15),
        sort: z.enum(['cost', 'cash', 'total', 'fairness', 'duration', 'total_time', 'per_person_max']).optional(),
      },
    },
    async (a) =>
      json(
        scoredOptions(db, requireCfg(a.tripId), {
          prefs: a.prefs ?? null,
          gateways: a.gateways ?? null,
          includeIncomplete: a.includeIncomplete ?? false,
          top: a.top,
          sort: a.sort ?? null,
          provider: provider.name,
        }),
      ),
  )

  mcp.registerTool(
    'get_option_detail',
    {
      description:
        'Full detail for one option: every party\'s segments, layovers, waits between split tickets (bufferOutMin/bufferBackMin). Structural only — pricing/delta fields come from get_options.',
      inputSchema: { tripId: z.string().default('main'), optionId: z.string() },
    },
    async (a) => {
      const option = findOption(db, requireCfg(a.tripId), a.optionId, true, provider.name)
      if (!option) throw new Error(`unknown option ${a.optionId}`)
      return json(option)
    },
  )

  mcp.registerTool(
    'get_solo_baselines',
    {
      description:
        'Per-party fly-alone candidates (what each party could do abandoning the group). Best per prefs = min over candidates of perPersonCents + hourly*(doorMin/60)*100 + (1-timeQuality)*oddDollars*100. Compare against a group option to price togetherness.',
      inputSchema: { tripId: z.string().default('main') },
    },
    async (a) => json(soloCandidates(db, requireCfg(a.tripId), provider.name)),
  )

  mcp.registerTool(
    'get_cache_stats',
    {
      description:
        'Query budget for a trip: estimatedFullRefreshQueries vs cachedQueries (how many live provider searches a refresh would actually run) + lastFetchedAt for staleness.',
      inputSchema: { tripId: z.string().default('main') },
    },
    async (a) => {
      const cfg = requireCfg(a.tripId)
      const specs = planQueries(cfg)
      const stmt = db.prepare(`SELECT 1 FROM searches WHERE params_hash = ? AND status IN ('ok','empty') LIMIT 1`)
      const cachedQueries = specs.filter((s) => stmt.get(specHash(provider.name, s))).length
      const last = db.prepare(`SELECT MAX(fetched_at) AS last FROM searches`).get() as { last: string | null }
      return json({ estimatedFullRefreshQueries: specs.length, cachedQueries, lastFetchedAt: last.last })
    },
  )

  mcp.registerTool(
    'create_trip',
    {
      description:
        'Start a NEW search — the polite way to explore a variation (never edit someone else\'s trip; clone instead). cloneFrom copies another trip\'s config (cache is shared, clones are cheap). Returns the trip id and its page URL.',
      inputSchema: {
        name: z.string(),
        cloneFrom: z.string().optional().describe('trip id to copy the setup from, e.g. "main"'),
      },
    },
    async (a) => {
      const config = a.cloneFrom ? requireCfg(a.cloneFrom) : DEFAULT_CONFIG
      const trip = createTrip(db, a.name, config)
      return json({ ...trip, pageUrl: `${publicBase}/t/${trip.id}` })
    },
  )

  mcp.registerTool(
    'update_trip_config',
    {
      description:
        'Replace a trip\'s config (the previous version is auto-saved to that trip\'s history). Only update trips YOU created this session — clone "main" rather than editing it. Then check get_cache_stats before refreshing.',
      inputSchema: { tripId: z.string(), config: z.record(z.unknown()).describe('full TripConfig object (get one via list_trips and modify)') },
    },
    async (a) => {
      const parsed = TripConfigSchema.parse(a.config)
      requireCfg(a.tripId)
      recordHistoryBeforeOverwrite(db, a.tripId, parsed)
      saveTripConfig(db, a.tripId, parsed)
      return json(parsed)
    },
  )

  mcp.registerTool(
    'start_refresh',
    {
      description:
        'Run the live fare sweep for a trip (cache-aware; concurrent identical refreshes coalesce). COSTS LIVE PROVIDER QUERIES — check get_cache_stats first, never loop, and use force only on explicit user request. Returns a job; poll with get_refresh_job.',
      inputSchema: { tripId: z.string().default('main'), force: z.boolean().default(false) },
    },
    async (a) => {
      const cfg = requireCfg(a.tripId)
      const specs = planQueries(cfg)
      const gentle = provider.name !== 'fixture'
      const job = startRefresh(db, provider, cfg, specs, {
        force: a.force,
        concurrency: gentle ? 1 : 4,
        spacingMs: gentle ? 1100 : 0,
      })
      return json(job)
    },
  )

  mcp.registerTool(
    'get_refresh_job',
    { description: 'Poll a refresh job by id.', inputSchema: { jobId: z.string() } },
    async (a) => {
      const job = getJob(a.jobId)
      if (!job) throw new Error(`unknown job ${a.jobId}`)
      return json(job)
    },
  )

  mcp.registerTool(
    'synthesize_split_tickets',
    {
      description:
        'For an option with missingParties: price separate positioning + trunk tickets so they can join (~3-6 live queries). Re-fetch the option afterwards.',
      inputSchema: { tripId: z.string().default('main'), optionId: z.string() },
    },
    async (a) => json(await synthesizeSplitTickets(db, provider, requireCfg(a.tripId), a.optionId)),
  )

  mcp.registerTool(
    'create_snapshot',
    {
      description:
        'Freeze a trip\'s scored results at a permanent share URL — THE way to hand findings to a human. top: 0 shares the config alone. Returns shareUrl; give that to the user (it needs their group password in a browser).',
      inputSchema: {
        tripId: z.string().default('main'),
        name: z.string().optional(),
        prefs: z.string().optional(),
        gateways: z.enum(['us', 'nonus']).optional(),
        top: z.number().int().min(0).max(200).default(50),
      },
    },
    async (a) => {
      const cfg = requireCfg(a.tripId)
      const configOnly = a.top === 0
      const options = configOnly
        ? []
        : scoredOptions(db, cfg, {
            prefs: a.prefs ?? null,
            gateways: a.gateways ?? null,
            top: a.top,
            provider: provider.name,
            withSegments: true,
          })
      const meta = createSnapshot(db, {
        name: a.name ?? null,
        provider: provider.name,
        config: cfg,
        prefs: parsePrefsParam(a.prefs ?? null),
        query: { gateways: a.gateways ?? null, includeIncomplete: false, top: a.top },
        options,
        solo: configOnly ? [] : soloCandidates(db, cfg, provider.name),
      })
      return json({ ...meta, shareUrl: `${publicBase}${meta.url}` })
    },
  )

  mcp.registerTool(
    'list_snapshots',
    { description: 'Existing frozen share links.', inputSchema: {} },
    async () => json(listSnapshots(db).map((s) => ({ ...s, shareUrl: `${publicBase}${s.url}` }))),
  )

  return mcp
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : undefined
}

/** Stateless Streamable-HTTP MCP handler: fresh server+transport per request. */
export function mcpHandler(db: DB, provider: FlightProvider) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' })
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'stateless server: POST only' }, id: null }))
      return
    }
    const proto = (req.headers['x-forwarded-proto'] as string) ?? 'http'
    const host = (req.headers['x-forwarded-host'] as string) ?? req.headers.host ?? 'localhost:3000'
    const publicBase = `${proto}://${host}`
    try {
      const body = await readBody(req)
      const mcp = buildMcp(db, provider, publicBase)
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      res.on('close', () => {
        void transport.close()
        void mcp.close()
      })
      await mcp.connect(transport)
      await transport.handleRequest(req, res, body)
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: e instanceof Error ? e.message : 'internal error' }, id: null }))
      }
    }
  }
}
