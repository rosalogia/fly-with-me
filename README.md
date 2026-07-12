# fly with me ✈️

Find flights for a group scattered across the US who want to fly to China (or anywhere)
**together** — on the same long-haul flights — while trading off price, fairness, duration,
layovers, and time-of-day, against real bookable fares.

## Quick start

```bash
npm install
cp .env.example .env    # add a Duffel API token for real fares (https://app.duffel.com)
npm run dev             # UI at http://localhost:5173, API at http://localhost:3000
```

Without a Duffel token the app runs on a deterministic synthetic provider — good for
playing with the UI, not for booking.

1. **Trip setup** tab: set your parties, destination airports (swap "into"/"out of" to
   reverse the trip direction), date range, and constraints. Save, then **Refresh flight
   data** (~96 provider searches, cached — repeat refreshes are free).
2. **Options** tab: every trunk-flight combination all parties can share, scored 0–1 by
   your weighted goals. Drag sliders or toggle goals — re-ranking is instant, no refetch.
   `PARETO` marks options nothing else beats on every enabled goal.
3. Click a row for per-person itineraries (shared trunk highlighted). If a party has no
   single-ticket route to a trunk, **Price split ticket** builds a separate positioning +
   trunk combination, with self-transfer buffers and risk flags shown honestly.

There's also a JSON API and a CLI (`npm run fwm -- options --top 10`) — see `CLAUDE.md`.

**Sharing a specific result set**: press “Share these results” on the Options page — it
freezes the current view (your knobs, filters, top 100 options) at a `/s/<id>` link and
copies it. Recipients see exactly what you saw (fares move; the frozen page says so),
can re-price with their own knobs, and can load the trip setup into the live app.

## Sharing with your group

Set a password first (in `.env`):

```
SHARE_PASSWORD=something-you-tell-your-friends
```

Then:

```bash
npm run share
```

This builds the UI, serves everything on one port, and opens a free Cloudflare tunnel —
it prints a public `https://…trycloudflare.com` URL you can text to the group (login:
user `group`, the password you set). The link works as long as the command keeps running
on your machine; a new URL is minted each run.

### A stable URL (instead of a fresh tunnel link each run)

Two options, in increasing permanence:

1. **Named Cloudflare tunnel** — free, stable hostname, still runs on your machine.
   Needs a Cloudflare account **and a domain in it**: `cloudflared tunnel login`,
   `cloudflared tunnel create fwm`, route a DNS name to it, then run
   `cloudflared tunnel run fwm` instead of the quick tunnel.
2. **Always-on deploy (recommended)** — a `Dockerfile` and `fly.toml` are included.
   On Fly.io: `fly launch --copy-config --no-deploy`, `fly volumes create data --size 1`,
   `fly secrets set DUFFEL_TOKEN=... SHARE_PASSWORD=...`, `fly deploy` → a permanent
   `https://<app>.fly.dev` that doesn't care whether your laptop is awake. Any Docker
   host works the same way: persist `/data`, set the two secrets, expose port 3000.

## Tests

```bash
npm test
```
