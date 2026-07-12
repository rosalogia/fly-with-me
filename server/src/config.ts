import { randomBytes } from 'node:crypto'
import { DEFAULT_CONFIG, TripConfigSchema, type TripConfig } from '@fwm/shared'
import type { DB } from './db/db.js'

/** The migrated original search keeps a stable, memorable id. */
export const MAIN_TRIP = 'main'

export interface TripMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  config: TripConfig
}

const canonical = (c: TripConfig) => JSON.stringify(TripConfigSchema.parse(c))

export function listTrips(db: DB): TripMeta[] {
  const rows = db
    .prepare(`SELECT id, name, json, created_at, updated_at FROM trips ORDER BY updated_at DESC`)
    .all() as Record<string, string>[]
  return rows.map((r) => ({
    id: r.id!,
    name: r.name!,
    createdAt: r.created_at!,
    updatedAt: r.updated_at!,
    config: TripConfigSchema.parse(JSON.parse(r.json!)),
  }))
}

export function getTrip(db: DB, id: string): TripMeta | undefined {
  const r = db.prepare(`SELECT id, name, json, created_at, updated_at FROM trips WHERE id = ?`).get(id) as
    | Record<string, string>
    | undefined
  if (!r) return undefined
  return {
    id: r.id!,
    name: r.name!,
    createdAt: r.created_at!,
    updatedAt: r.updated_at!,
    config: TripConfigSchema.parse(JSON.parse(r.json!)),
  }
}

export function createTrip(db: DB, name: string, config: TripConfig, id?: string): TripMeta {
  const tripId = id ?? randomBytes(5).toString('base64url')
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO trips (id, name, json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(
    tripId, name.trim() || 'Untitled search', canonical(config), now, now,
  )
  return getTrip(db, tripId)!
}

export function renameTrip(db: DB, id: string, name: string): boolean {
  return db
    .prepare(`UPDATE trips SET name = ?, updated_at = ? WHERE id = ?`)
    .run(name.trim() || 'Untitled search', new Date().toISOString(), id).changes > 0
}

export function deleteTrip(db: DB, id: string): boolean {
  if (id === MAIN_TRIP) return false // the group's shared search is not deletable over HTTP
  db.prepare(`DELETE FROM config_history WHERE trip_id = ?`).run(id)
  return db.prepare(`DELETE FROM trips WHERE id = ?`).run(id).changes > 0
}

export function loadTripConfig(db: DB, tripId: string): TripConfig | undefined {
  return getTrip(db, tripId)?.config
}

export function saveTripConfig(db: DB, tripId: string, cfg: TripConfig): void {
  db.prepare(`UPDATE trips SET json = ?, updated_at = ? WHERE id = ?`).run(
    canonical(cfg), new Date().toISOString(), tripId,
  )
}

// ---------------- per-trip config history ----------------

const HISTORY_CAP = 50

export interface HistoryEntry {
  id: number
  savedAt: string
  config: TripConfig
}

export function recordHistoryBeforeOverwrite(db: DB, tripId: string, incoming: TripConfig): void {
  const current = loadTripConfig(db, tripId)
  if (!current || canonical(current) === canonical(incoming)) return
  db.prepare(`INSERT INTO config_history (trip_id, json, saved_at) VALUES (?, ?, ?)`).run(
    tripId, canonical(current), new Date().toISOString(),
  )
  db.prepare(
    `DELETE FROM config_history WHERE trip_id = ? AND id NOT IN
       (SELECT id FROM config_history WHERE trip_id = ? ORDER BY id DESC LIMIT ?)`,
  ).run(tripId, tripId, HISTORY_CAP)
}

export function listHistory(db: DB, tripId: string, limit = 20): HistoryEntry[] {
  const rows = db
    .prepare(`SELECT id, json, saved_at FROM config_history WHERE trip_id = ? ORDER BY id DESC LIMIT ?`)
    .all(tripId, limit) as { id: number; json: string; saved_at: string }[]
  return rows.map((r) => ({ id: r.id, savedAt: r.saved_at, config: TripConfigSchema.parse(JSON.parse(r.json)) }))
}

export function restoreHistory(db: DB, tripId: string, id: number): TripConfig | undefined {
  const row = db
    .prepare(`SELECT json FROM config_history WHERE id = ? AND trip_id = ?`)
    .get(id, tripId) as { json: string } | undefined
  if (!row) return undefined
  const cfg = TripConfigSchema.parse(JSON.parse(row.json))
  recordHistoryBeforeOverwrite(db, tripId, cfg)
  saveTripConfig(db, tripId, cfg)
  return cfg
}

// ---------------- migration + legacy singleton compat ----------------

/** One-time migration: the old singleton config and named variants become trips. */
export function migrateToTrips(db: DB): void {
  const hasTrips = (db.prepare(`SELECT COUNT(*) AS n FROM trips`).get() as { n: number }).n > 0
  if (hasTrips) return
  const singleton = db.prepare(`SELECT json FROM config WHERE id = 1`).get() as { json: string } | undefined
  const mainCfg = singleton ? TripConfigSchema.parse(JSON.parse(singleton.json)) : DEFAULT_CONFIG
  createTrip(db, 'Main trip', mainCfg, MAIN_TRIP)
  const variants = db.prepare(`SELECT name, json FROM variants`).all() as { name: string; json: string }[]
  for (const v of variants) {
    const cfg = TripConfigSchema.parse(JSON.parse(v.json))
    if (canonical(cfg) !== canonical(mainCfg)) createTrip(db, v.name, cfg)
  }
}

/** Legacy singleton accessors — the old endpoints operate on the main trip. */
export function loadConfig(db: DB): TripConfig {
  const cfg = loadTripConfig(db, MAIN_TRIP)
  if (cfg) return cfg
  migrateToTrips(db)
  return loadTripConfig(db, MAIN_TRIP)!
}

export function saveConfig(db: DB, cfg: TripConfig): void {
  if (!getTrip(db, MAIN_TRIP)) migrateToTrips(db)
  saveTripConfig(db, MAIN_TRIP, cfg)
}
