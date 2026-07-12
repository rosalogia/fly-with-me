# fly-with-me — guide for AI agents

Source code (verify any behavior described here): https://github.com/rosalogia/fly-with-me

You are talking to a group flight-search service. A group of travelers ("parties") in
different cities wants to fly to China together — on identical long-haul flights — and
this service finds and prices every way to do that using real, bookable fares.

Your job is usually: answer a traveler's question, explore a variation they're curious
about, or package findings into a link they can share with their group.

Base URL: the origin this file was served from. Auth, when enabled, accepts EITHER:
- HTTP basic (username `group`, password from your user), or
- the same password as a query parameter: append `?key=<password>` (or `&key=` when the
  URL already has params) to EVERY request — it is not a session. Use this if your fetch
  tool cannot send headers.
Auth may also be disabled entirely; if your first request succeeds bare, none is needed.
Machine-readable endpoint list: `GET /api`.

## Golden rules

1. **Read before you write.** Most questions are answerable from cached data with GET
   requests — start with `GET /api/trips` and `GET /api/trips/<id>/options`.
2. **Clone, don't clobber.** Configs are editable by everyone. To explore a variation,
   `POST /api/trips {"name":"...", "cloneFrom":"main"}` and edit YOUR copy. The shared
   `main` trip belongs to the whole group. (Overwrites are recoverable via
   `/config/history`, but don't rely on that.)
3. **Live searches cost real quota.** `POST .../refresh` and `POST .../options/<id>/synthesize`
   hit a live fare provider. Run a refresh when data is missing or stale — never in a loop.
   Check `GET .../cache/stats` first: `cachedQueries` vs `estimatedFullRefreshQueries`
   tells you how much a refresh will actually fetch.
4. **Show humans deltas, not absolutes.** Present `cashCents` (real money) and
   `deltaVsBestCents` ("picking this over the best option effectively costs +$X").
   `trueCostCents` includes ~$6k of dollar-valued travel time — it reads as a scary fake
   price. Never present it as something anyone pays.
5. **Share via snapshots.** To send findings to a human, create a snapshot and give them
   the `/s/<id>` link — it's a frozen, human-friendly page that never changes. Trip links
   (`/t/<id>`) are live and change with refreshes.

## The data model in 60 seconds

- **trip** — one search: parties (who, from where, how many), airports into/out of China,
  a date window, constraints. Lives at `/t/<id>`; API under `/api/trips/<id>/...`.
- **option** — one way the whole group can travel together: a pair of shared flight
  sequences (the "trunks": everyone must be on these exact flights) plus each party's
  ticket to join them. `parties[]` = single protected tickets; `splitTickets[]` = parties
  joining on separate unprotected tickets (positioning flight + trunk ticket, with waits
  and `self_transfer_risk`); `missingParties[]` = no priced route yet (synthesize to fix).
  Split-ticket fields: `bufferOutMin` = positioning arrival → trunk departure at the
  meeting airport; `bufferBackMin` = trunk arrival → positioning-home departure;
  `overnightNights` = estimated gateway hotel nights (any wait >16h counts one), priced by
  the hotel pref. NOTE an intended asymmetry: single tickets must depart after the config's
  Friday-evening cutoff, but split-ticket POSITIONING legs may leave up to two days
  earlier (still after the same local time) to make the buffer — so "you'd leave Thursday
  evening" is by design, not a bug, and worth telling the traveler explicitly.
- **prefs** — the user's exchange rates, all in dollars:
  `prefs=hourly:20,risk:300,hotel:150,fairness:0,odd:50` = $/person-hour of travel,
  $/party on split tickets, $/positioning hotel night, $ per $1 of per-person price gap
  (0 = the group settles up after), max $/person for awful flight times. Generalized cost
  = tickets + all of those; the lowest becomes the **benchmark** and everything else gets
  `deltaVsBestCents` + `deltaBreakdown` (six components — tickets/hotel/risk/time/oddHours/
  fairness — that sum exactly to `deltaVsBestCents`; the breakdown's `totalCents` field is
  that same sum, included for convenience, so skip it when adding components). Omitting
  `prefs` applies the defaults shown above.
- **pareto: true** — nothing else is cheaper AND faster AND fairer; the honest shortlist.
- **solo** (`GET .../solo`) — per-party fly-alone candidates, selected PER DATE PAIR.
  For a like-for-like comparison against a group option, FIRST filter candidates to that
  option's `pairDepart`/`pairReturn`, then min-by:
  `perPersonCents + hourly*(doorMin/60)*100 + (1-timeQuality)*odd*100`. (An unfiltered min
  answers a different question — "leave the group AND move the dates".) Each candidate has
  an `href` to its full segments, so claims are verifiable.
- **snapshot** — frozen config+results at `/s/<id>`. `top: 0` = config-only (share a setup).

## Recipes

**"What are our best options?"**
`GET /api/trips/main/options?top=10` → present the benchmark and 2–4 pareto options as
trade-offs (cash vs door-to-door hours vs risk), with `deltaBreakdown` explaining each
gap in plain words. Mention who'd be on split tickets.

**"What's cheapest for me?" (the user is one party)**
Same call; per option their price is `parties[].perPersonCents` or
`splitTickets[].perPersonCents` for their partyId. Warn when their entry is a split
ticket (unprotected, long waits — the option detail shows exact wait times).

**"What if we flew into Shanghai / in November / from Boston?"**
1. `POST /api/trips {"name":"via Shanghai","cloneFrom":"main"}` → `<id>`
2. `GET /api/trips/<id>/config` → modify → `PUT` it back
3. `GET /api/trips/<id>/cache/stats` → tell the user how many live searches a refresh
   needs (cache is shared across trips, so overlaps are free)
4. `POST /api/trips/<id>/refresh {}` → poll `GET /api/refresh/<jobId>` until done
5. `GET /api/trips/<id>/options?top=10` → compare against main's options
6. Share: `POST /api/trips/<id>/snapshots {"name":"...","top":50}` → give the human
   BOTH links: `/s/<snapshotId>` (frozen findings) and `/t/<id>` (live search).

**"Share what we're looking at with the group."**
`POST /api/trips/<id>/snapshots {"name":"...","top":50}` on ANY trip (main included) →
response has `url` → give the human `<base-url>/s/<snapshotId>`. Prefs/filters you pass
in the body (`prefs`, `gateways`, `includeIncomplete`) are baked into the frozen results;
recipients can still re-price with their own knobs on the page. `top: 0` shares the
config alone.

**"Can MIA join that option somehow?"** (option has `missingParties`)
`POST /api/trips/<id>/options/<optionId>/synthesize` (~3–6 live searches) → re-fetch the
option; a new `splitTickets` entry appears or `reports[]` explains why not.

**"Is traveling together even worth it?"**
`GET .../solo` vs the benchmark option: compare each party's solo best (price + doorMin)
against their cost inside the group option. The gap is the price of togetherness — some
parties may actually do BETTER in the group.

**"The prices look stale."**
`GET .../cache/stats` → `lastFetchedAt`. If old, one `POST .../refresh {}` (not forced);
`force: true` only when the user explicitly wants everything re-fetched.

**"How do we actually BOOK this?"**
This service doesn't sell tickets, and its provider offers expire in minutes — never
present a fare as purchasable here. Build "verify & book" links to prefilled searches
instead, one per TICKET (split-ticket parties book up to three):
- Kayak: `https://www.kayak.com/flights/<ORIG>-<DEST>/<YYYY-MM-DD>[/<ORIG2>-<DEST2>/<YYYY-MM-DD>]`
  (two path pairs = the open-jaw; one = a one-way positioning ticket)
- Google Flights: `https://www.google.com/travel/flights?q=` + url-encoded
  `flights from <ORIG> to <DEST> on <date> and from <ORIG2> to <DEST2> on <date2>`
Tell the user to match the FLIGHT NUMBERS from the option on the results page — that's
the validation that the fare still exists — then buy there. The option-detail drawer in
the web UI shows the same links per ticket.

If you have a browser tool, you can go one step further: open the Google Flights link,
select the itinerary whose carrier/flight numbers/times match the option, and you land on
`google.com/travel/flights/booking?tfs=…` — a STABLE, shareable deep link to that exact
flight's booking page (it encodes the flight numbers), listing fare classes and "Book
with <airline>" handoffs. Give your user THAT url — it's the best artifact: one click from
purchase, with the live price visible. Never click Continue/purchase yourself; report the
current price vs the cached one and stop. Kayak works too but its bot-detection is
moodier; prefer Google Flights for automation.

## Gotchas

- Option **detail** (`GET .../options/<id>`) is structural (segments, waits); pricing
  fields live only in the options **list** (they depend on prefs + the whole result set).
- Sort keys: `cost` (default), `cash`, `total` (tickets only), `fairness`, `duration`,
  `total_time`, `per_person_max`.
- Filters change the benchmark: `gateways=us|nonus`, `includeIncomplete=1`.
- All money fields are integer cents; times are minutes; segment times are local.
- Fares move constantly. Timestamp any numbers you quote (`cache/stats.lastFetchedAt`),
  and never promise a price — this service doesn't book, it decides.
