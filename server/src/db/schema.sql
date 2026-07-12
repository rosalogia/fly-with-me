-- Legacy singleton (kept for migration; superseded by trips).
CREATE TABLE IF NOT EXISTS config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- First-class searches: each trip is a config with its own URL (/t/<id>).
-- The provider cache is global and query-keyed, so trips share fetches.
CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One row per provider call; raw_json is the source of truth for re-ingestion.
CREATE TABLE IF NOT EXISTS searches (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('openjaw', 'trunk_only', 'positioning')),
  params_hash TEXT NOT NULL,
  params_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error', 'empty')),
  error TEXT,
  raw_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_searches_hash ON searches (params_hash, fetched_at DESC);

-- One priced offer for one party.
CREATE TABLE IF NOT EXISTS itineraries (
  id INTEGER PRIMARY KEY,
  search_id INTEGER NOT NULL REFERENCES searches (id) ON DELETE CASCADE,
  party_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('openjaw', 'trunk_only', 'positioning_out', 'positioning_back')),
  provider_offer_id TEXT,
  dep_date TEXT,
  ret_date TEXT,
  travelers INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  per_person_cents INTEGER NOT NULL,
  outbound_trunk_key TEXT,
  return_trunk_key TEXT,
  raw_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_itin_trunks ON itineraries (outbound_trunk_key, return_trunk_key, party_id);
CREATE INDEX IF NOT EXISTS idx_itin_search ON itineraries (search_id);
CREATE INDEX IF NOT EXISTS idx_itin_kind ON itineraries (kind, party_id, dep_date);

CREATE TABLE IF NOT EXISTS segments (
  id INTEGER PRIMARY KEY,
  itinerary_id INTEGER NOT NULL REFERENCES itineraries (id) ON DELETE CASCADE,
  leg TEXT NOT NULL CHECK (leg IN ('outbound', 'return')),
  pos INTEGER NOT NULL,
  carrier TEXT NOT NULL,
  flight_number TEXT NOT NULL,
  operating_carrier TEXT,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  departs_local TEXT NOT NULL,
  arrives_local TEXT NOT NULL,
  origin_tz TEXT NOT NULL,
  dest_tz TEXT NOT NULL,
  duration_min INTEGER,
  aircraft TEXT,
  is_trunk INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_segments_itin ON segments (itinerary_id, leg, pos);

-- Named trip-setup variations ("what if we flew into Shanghai?"). The `config`
-- singleton stays the ACTIVE setup; variants are the library you switch between.
CREATE TABLE IF NOT EXISTS variants (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Every overwrite of a trip's config appends the OUTGOING version here
-- (capped per trip), so no setup is ever lost — by a human or an agent.
CREATE TABLE IF NOT EXISTS config_history (
  id INTEGER PRIMARY KEY,
  trip_id TEXT NOT NULL DEFAULT 'main',
  json TEXT NOT NULL,
  saved_at TEXT NOT NULL
);

-- Frozen, shareable snapshots: a trip config + its scored results at save time.
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  provider TEXT NOT NULL,
  config_json TEXT NOT NULL,
  prefs_json TEXT NOT NULL,
  query_json TEXT NOT NULL,   -- filters used (gateways, includeIncomplete, top)
  options_json TEXT NOT NULL, -- ScoredOptionDto[] incl. segments (self-contained)
  solo_json TEXT              -- SoloCandidateDto[]: per-party fly-alone baselines
);

-- Synthesized split-ticket coverage for a party on a given trunk pair.
CREATE TABLE IF NOT EXISTS split_tickets (
  id INTEGER PRIMARY KEY,
  outbound_trunk_key TEXT NOT NULL,
  return_trunk_key TEXT NOT NULL,
  party_id TEXT NOT NULL,
  trunk_itin_id INTEGER NOT NULL REFERENCES itineraries (id) ON DELETE CASCADE,
  pos_out_itin_id INTEGER NOT NULL REFERENCES itineraries (id) ON DELETE CASCADE,
  pos_back_itin_id INTEGER NOT NULL REFERENCES itineraries (id) ON DELETE CASCADE,
  total_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  buffer_out_min INTEGER NOT NULL,
  buffer_back_min INTEGER NOT NULL,
  flags_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (outbound_trunk_key, return_trunk_key, party_id)
);
