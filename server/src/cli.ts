import './env.js'
import { DEFAULT_CONFIG, TripConfigSchema, parsePrefsParam } from '@fwm/shared'
import { readFileSync } from 'node:fs'
import {
  MAIN_TRIP, createTrip, getTrip, listHistory, listTrips, loadTripConfig,
  migrateToTrips, recordHistoryBeforeOverwrite, saveTripConfig,
} from './config.js'
import { findOption } from './core/groupOptions.js'
import { createSnapshot, listSnapshots } from './core/snapshots.js'
import { soloCandidates } from './core/solo.js'
import { synthesizeSplitTickets } from './core/splitTicket.js'
import { openDb } from './db/db.js'
import { deriveDatePairs } from './fetch/datePairs.js'
import { startRefresh, waitForJob } from './fetch/fetcher.js'
import { planQueries } from './fetch/queryPlanner.js'
import { dbPathFromEnv } from './paths.js'
import { getProvider } from './providers/index.js'
import { scoredOptions } from './api/routes.js'

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      positional.push(a)
    }
  }
  return { positional, flags }
}

const out = (x: unknown) => console.log(JSON.stringify(x, null, 2))

const HELP = `fwm — fly-with-me CLI (all output is JSON)

Every search is a trip; most commands accept --trip <id> (default: "${MAIN_TRIP}").

  fwm trips                         list all searches
  fwm trip-new --name "..." [--clone <tripId>] [--file cfg.json]
                                    start a new search (UI at /t/<id>)
  fwm config [--trip id] [--file cfg.json]
                                    print (or replace) a trip's config
  fwm date-pairs [--trip id]        derived (depart, return) date pairs
  fwm plan [--trip id]              the provider queries a refresh would run
  fwm refresh [--trip id] [--force] run the search sweep (cache-aware)
  fwm options [--trip id] [--top N] [--prefs hourly:20,risk:300,...]
              [--include-incomplete] [--gateways us|nonus] [--sort cost|...]
  fwm show <optionId> [--trip id]   full detail incl. per-party segments
  fwm synthesize <optionId> [--trip id]
                                    build split-ticket coverage for missing parties
  fwm snapshot [--trip id] [--name "..."] [--prefs ...] [--top 100]
                                    freeze config+results at a shareable /s/<id> URL
  fwm snapshots                     list saved snapshots
  fwm solo [--trip id]              per-party fly-alone baselines
  fwm stats [--trip id]             cache stats + this trip's query budget
  fwm sql "<query>"                 raw SQL against the cache db (local tool — be careful)
`

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const { positional, flags } = parseFlags(rest)
  const db = openDb(dbPathFromEnv())
  migrateToTrips(db)

  const tripId = typeof flags.trip === 'string' ? flags.trip : MAIN_TRIP
  const requireCfg = () => {
    const cfg = loadTripConfig(db, tripId)
    if (!cfg) throw new Error(`unknown trip ${tripId} — run: fwm trips`)
    return cfg
  }

  switch (cmd) {
    case 'trips':
      out(listTrips(db).map((t) => ({ id: t.id, name: t.name, updatedAt: t.updatedAt, url: `/t/${t.id}` })))
      break
    case 'trip-new': {
      const name = typeof flags.name === 'string' ? flags.name : 'Untitled search'
      let config = DEFAULT_CONFIG
      if (typeof flags.clone === 'string') {
        const src = loadTripConfig(db, flags.clone)
        if (!src) throw new Error(`unknown trip ${flags.clone}`)
        config = src
      } else if (typeof flags.file === 'string') {
        config = TripConfigSchema.parse(JSON.parse(readFileSync(flags.file, 'utf8')))
      }
      const trip = createTrip(db, name, config)
      out({ ...trip, url: `/t/${trip.id}` })
      break
    }
    case 'config': {
      if (flags.file && typeof flags.file === 'string') {
        const cfg = TripConfigSchema.parse(JSON.parse(readFileSync(flags.file, 'utf8')))
        recordHistoryBeforeOverwrite(db, tripId, cfg)
        saveTripConfig(db, tripId, cfg)
        out(cfg)
      } else {
        out(requireCfg())
      }
      break
    }
    case 'history':
      out(listHistory(db, tripId))
      break
    case 'date-pairs':
      out(deriveDatePairs(requireCfg()))
      break
    case 'plan':
      out(planQueries(requireCfg()))
      break
    case 'refresh': {
      const cfg = requireCfg()
      const provider = getProvider()
      const specs = planQueries(cfg)
      console.error(`refreshing ${specs.length} searches via ${provider.name}...`)
      const gentle = provider.name !== 'fixture'
      const job = startRefresh(db, provider, cfg, specs, {
        force: flags.force === true,
        concurrency: gentle ? 1 : 4,
        spacingMs: gentle ? 1100 : 0,
      })
      const interval = setInterval(() => {
        console.error(`  ${job.done}/${job.total} (${job.skippedCacheHits} cache hits, ${job.errors.length} errors)`)
      }, 2000)
      const finished = await waitForJob(job.id)
      clearInterval(interval)
      out(finished)
      break
    }
    case 'options': {
      out(
        scoredOptions(db, requireCfg(), {
          provider: getProvider().name,
          prefs: typeof flags.prefs === 'string' ? flags.prefs : null,
          includeIncomplete: flags['include-incomplete'] === true,
          sort: typeof flags.sort === 'string' ? flags.sort : null,
          top: typeof flags.top === 'string' ? Number(flags.top) : null,
          gateways: typeof flags.gateways === 'string' ? flags.gateways : null,
        }),
      )
      break
    }
    case 'show': {
      const id = positional[0]
      if (!id) throw new Error('usage: fwm show <optionId> [--trip id]')
      const option = findOption(db, requireCfg(), id, true, getProvider().name)
      if (!option) throw new Error(`unknown option ${id}`)
      out(option)
      break
    }
    case 'synthesize': {
      const id = positional[0]
      if (!id) throw new Error('usage: fwm synthesize <optionId> [--trip id]')
      out(await synthesizeSplitTickets(db, getProvider(), requireCfg(), id))
      break
    }
    case 'snapshot': {
      const cfg = requireCfg()
      const prefsStr = typeof flags.prefs === 'string' ? flags.prefs : null
      const query = {
        gateways: typeof flags.gateways === 'string' ? flags.gateways : null,
        includeIncomplete: flags['include-incomplete'] === true,
        top: typeof flags.top === 'string' ? Number(flags.top) : 100,
      }
      const configOnly = query.top === 0
      const options = configOnly
        ? []
        : scoredOptions(db, cfg, {
            provider: getProvider().name,
            prefs: prefsStr,
            includeIncomplete: query.includeIncomplete,
            gateways: query.gateways,
            top: query.top,
            withSegments: true,
          })
      const meta = createSnapshot(db, {
        name: typeof flags.name === 'string' ? flags.name : null,
        provider: getProvider().name,
        config: cfg,
        prefs: parsePrefsParam(prefsStr),
        query,
        options,
        solo: configOnly ? [] : soloCandidates(db, cfg, getProvider().name),
      })
      out({ ...meta, shareUrl: `http://localhost:${process.env.PORT ?? 3000}${meta.url}` })
      break
    }
    case 'snapshots':
      out(listSnapshots(db))
      break
    case 'solo':
      out(soloCandidates(db, requireCfg(), getProvider().name))
      break
    case 'stats': {
      const counts = db
        .prepare(`SELECT COUNT(*) AS searches, MAX(fetched_at) AS last FROM searches`)
        .get()
      const itins = db.prepare(`SELECT COUNT(*) AS itineraries FROM itineraries`).get()
      out({
        trip: getTrip(db, tripId)?.name ?? tripId,
        ...(counts as object),
        ...(itins as object),
        estimatedFullRefreshQueries: planQueries(requireCfg()).length,
      })
      break
    }
    case 'sql': {
      const q = positional[0]
      if (!q) throw new Error('usage: fwm sql "<query>"')
      const stmt = db.prepare(q)
      out(stmt.reader ? stmt.all() : stmt.run())
      break
    }
    default:
      console.log(HELP)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
