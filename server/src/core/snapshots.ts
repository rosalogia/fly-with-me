import { randomBytes } from 'node:crypto'
import {
  TripConfigSchema, type CostPrefs, type ScoredOptionDto, type SoloCandidateDto, type TripConfig,
} from '@fwm/shared'
import type { DB } from '../db/db.js'

export interface SnapshotMeta {
  id: string
  name: string
  createdAt: string
  provider: string
  optionCount: number
  url: string
}

export interface Snapshot extends SnapshotMeta {
  config: TripConfig
  prefs: CostPrefs
  query: { gateways?: string | null; includeIncomplete?: boolean; top?: number | null }
  options: ScoredOptionDto[]
  /** Per-party fly-alone baselines captured with the snapshot. */
  solo: SoloCandidateDto[]
}

export const snapshotPath = (id: string) => `/s/${id}`

function defaultName(cfg: TripConfig): string {
  return `${cfg.intoChina[0]} → ${cfg.outOfChina[0]}, departures ${cfg.dateRange.start} – ${cfg.dateRange.end}`
}

export function createSnapshot(
  db: DB,
  input: {
    name?: string | null
    provider: string
    config: TripConfig
    prefs: CostPrefs
    query: Snapshot['query']
    options: ScoredOptionDto[]
    solo?: SoloCandidateDto[]
  },
): SnapshotMeta {
  const id = randomBytes(6).toString('base64url')
  const createdAt = new Date().toISOString()
  const name = input.name?.trim() || defaultName(input.config)
  db.prepare(
    `INSERT INTO snapshots (id, name, created_at, provider, config_json, prefs_json, query_json, options_json, solo_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, name, createdAt, input.provider,
    JSON.stringify(input.config), JSON.stringify(input.prefs),
    JSON.stringify(input.query), JSON.stringify(input.options),
    JSON.stringify(input.solo ?? []),
  )
  return { id, name, createdAt, provider: input.provider, optionCount: input.options.length, url: snapshotPath(id) }
}

export function getSnapshot(db: DB, id: string): Snapshot | undefined {
  const row = db.prepare(`SELECT * FROM snapshots WHERE id = ?`).get(id) as
    | Record<string, string>
    | undefined
  if (!row) return undefined
  const options = JSON.parse(row.options_json!) as ScoredOptionDto[]
  return {
    id: row.id!,
    name: row.name!,
    createdAt: row.created_at!,
    provider: row.provider!,
    optionCount: options.length,
    url: snapshotPath(row.id!),
    config: TripConfigSchema.parse(JSON.parse(row.config_json!)),
    prefs: JSON.parse(row.prefs_json!) as CostPrefs,
    query: JSON.parse(row.query_json!),
    options,
    solo: row.solo_json ? (JSON.parse(row.solo_json) as SoloCandidateDto[]) : [],
  }
}

export function listSnapshots(db: DB): SnapshotMeta[] {
  const rows = db
    .prepare(`SELECT id, name, created_at, provider, options_json FROM snapshots ORDER BY created_at DESC`)
    .all() as Record<string, string>[]
  return rows.map((r) => ({
    id: r.id!,
    name: r.name!,
    createdAt: r.created_at!,
    provider: r.provider!,
    optionCount: (JSON.parse(r.options_json!) as unknown[]).length,
    url: snapshotPath(r.id!),
  }))
}

// Snapshots are deliberately not deletable over HTTP; local owner cleanup goes
// through the CLI: fwm sql "DELETE FROM snapshots WHERE id='…'".
