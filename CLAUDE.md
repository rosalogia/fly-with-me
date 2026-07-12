# fly-with-me

Group flight-search tool: 3 parties (DC, SEA, MIA — 5 travelers) fly to China together,
sharing the same transpacific "trunk" flights into and out of the country, scored across
weighted goals. TypeScript npm workspaces: `shared/` (zod config + scoring, used by both
sides), `server/` (Hono API + SQLite cache + provider adapters), `web/` (React + Vite).

## Running

```bash
npm run dev            # API on :3000 + web UI on :5173 (concurrently)
npm run dev:server     # API only
npm test               # vitest suite (all core logic + fixture-provider pipeline)
npm run fwm -- <cmd>   # CLI, same handlers as the API
```

Provider: set `DUFFEL_TOKEN` in `.env` (copy `.env.example`) for real data; without it the
app uses the deterministic **fixture provider** (synthetic but realistic itineraries — fine
for developing, meaningless for actual booking). `PROVIDER=fixture` forces synthetic mode.

## How Claude should drive this app

Prefer the HTTP API (server must be running) or the CLI (works without the server).
Everything speaks JSON. **Every search is a TRIP** (id + URL `/t/<id>`); the provider cache
is shared across trips, so cloning a trip and exploring costs nothing until the plan needs
uncached queries. The group's shared search is trip `main` (delete-protected); un-scoped
legacy endpoints (`/api/config`, `/api/options`, …) operate on it. **Prefer starting your
own trip (`cloneFrom: "main"`) over editing someone else's.** Prefer `/options` for scored
data; raw SQL only for segment-level forensics.

Agent access, most-capable first: (1) **MCP** at `/mcp` (streamable HTTP, stateless; 12
tools mirroring the API; auth via `?key=<SHARE_PASSWORD>` in the connector URL or basic
auth); (2) REST below; (3) fetch-only agents follow the absolute URLs served in
`/llms.txt?key=...` and the `href` fields in responses (never build URLs by hand).

```bash
curl -s localhost:3000/api                                 # self-describing endpoint index
curl -s localhost:3000/api/trips                           # all searches
curl -s -X POST localhost:3000/api/trips -d '{"name":"...","cloneFrom":"main"}'  # new search
T=localhost:3000/api/trips/main                            # (any trip id)
curl -s $T/config                                          # trip config; PUT replaces (old -> history)
curl -s $T/config/history                                  # auto-log; POST .../<id>/restore
curl -s $T/date-pairs                                      # derived (depart, return) pairs
curl -s -X POST $T/refresh -d '{}'                         # search sweep -> {id}; poll /api/refresh/<id>
curl -s "$T/options?top=10&prefs=hourly:20,risk:300,hotel:150,fairness:0,odd:50&gateways=us&sort=cost"
curl -s $T/options/<id>                                    # full per-party segments
curl -s -X POST $T/options/<id>/synthesize                 # price split tickets for missing parties
curl -s $T/trunks                                          # trunk pairs + party coverage
curl -s $T/solo                                            # per-party fly-alone baselines
curl -s $T/cache/stats                                     # query budget: estimated vs cachedQueries
curl -s -X POST $T/snapshots -d '{"name":"...","top":50}'  # freeze -> {id, url:"/s/<id>"}; top:0 = config only
curl -s localhost:3000/api/snapshots                       # list; GET /api/snapshots/<id> (no DELETE)
```

**Sharing results with the user**: create a snapshot (`fwm snapshot --name "..."` or POST
/api/snapshots), then give them the link — `http://localhost:5173/s/<id>` in dev,
`http://localhost:3000/s/<id>` in prod, or `<tunnel-url>/s/<id>` when `npm run share` is
running. Snapshots are FROZEN (config + prefs + scored options incl. segments, capped by
`top`, default 100) — refreshes never change them; recipients can re-price with their own
knobs and load the config into the live app.

CLI equivalents (all take `--trip <id>`, default `main`): `fwm trips`,
`fwm trip-new --name ... [--clone id]`, `fwm config [--file cfg.json]`, `fwm history`,
`fwm date-pairs`, `fwm plan`, `fwm refresh [--force]`,
`fwm options --top 10 --prefs ... --gateways us --include-incomplete --sort cost`,
`fwm show <id>`, `fwm synthesize <id>`, `fwm snapshot [--name ...] [--top 50]`,
`fwm snapshots`, `fwm solo` (per-party fly-alone baselines — the cost of togetherness),
`fwm stats`, `fwm sql "SELECT ..."`.

Scoring is **generalized cost in dollars**, presented as **deltas vs the benchmark**:
generalized cost = tickets + hotel (positioning nights, buffer>16h ⇒ 1/night) +
split-risk ($/split party) + time ($ × person-hours door-to-door; door-to-door = "time not
in China", buffers count in full) + odd-hours ((1−time_quality) × $/person) + fairness
($ per $ of per-person spread; default 0 = group settles up after). Prefs param:
`prefs=hourly:20,risk:300,hotel:150,fairness:0,odd:50` (all dollars). Response fields:
`cashCents` (tickets+hotels — the headline; real money), `benchmark: true` on the lowest
generalized-cost option in the set, `deltaVsBestCents` + `deltaBreakdown` (component-wise
vs the benchmark, sums exactly — THE decision-relevant numbers; the unavoidable
travel-time floor cancels out), `trueCostCents`/`breakdown` (absolute — for math, not for
showing users: the absolute number reads as a scary fake price). `gateways=us|nonus`
filters by meeting-gateway country. `pareto: true` = frontier over three FIXED axes (cash,
person-minutes, spread) — deliberately not the pref knobs, so "best" stays selective.

## Domain model (read this before touching core logic)

- **Trunk** = the segments everyone must share: outbound = first Asia-entering segment
  (LAX→PEK, SEA→ICN, or IST→PEK on via-Europe routings) through the final China arrival
  (suffix); return = first China departure through the first Asia-leaving segment
  (prefix). Key format: `CA986|2026-10-30|SFO-PKX` (multi-segment joined with `>`).
  Matching is by marketing carrier+number+date; codeshares intentionally distinct.
- **Group option** = a (outbound trunk, return trunk) pair. Complete when every party has a
  single-ticket open-jaw itinerary containing both trunks. Incomplete options are kept —
  they're candidates for **split tickets** (separate positioning + trunk-only tickets,
  flagged `self_transfer_risk`, min buffer `minSelfTransferMin`). Synthesis is lazy
  (per-option, ~3–6 extra searches) — never auto-run over all options.
- Hard filters at ingest: first departure ≥ `departAfterLocal` on the departure Friday;
  final return arrival ≤ Sunday 23:59 home-local. Everything else is a scored preference.
- Fetch and scoring are strictly separated: `server/src/fetch/` caches provider responses
  in SQLite (`data/cache.db`, key = params hash); scoring (`shared/src/scoring.ts`) is pure
  and instant over cached data. Changing weights NEVER refetches.

## Query budget

A full refresh ≈ parties×origins × date-pairs × intoChina×outOfChina searches (~96 for the
default config; check `/api/cache/stats`). Repeat refreshes are cache hits unless
`force: true`. With a live Duffel token searches are effectively free at this scale, but
don't force-refresh in a loop.

## DB tables (sqlite3 data/cache.db)

`searches` (query cache, raw provider JSON), `itineraries` (one priced offer per party;
trunk keys denormalized), `segments` (per-flight legs, `is_trunk` flag), `split_tickets`
(synthesized coverage), `config` (TripConfig singleton). Example forensics:

```sql
SELECT outbound_trunk_key, COUNT(DISTINCT party_id) FROM itineraries
WHERE kind='openjaw' GROUP BY 1 ORDER BY 2 DESC LIMIT 10;
```
