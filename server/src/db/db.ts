import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type DB = Database.Database

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), 'schema.sql')

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(readFileSync(schemaPath, 'utf8'))
  // Idempotent migrations for tables created before a column existed.
  for (const stmt of [
    `ALTER TABLE snapshots ADD COLUMN solo_json TEXT`,
    `ALTER TABLE config_history ADD COLUMN trip_id TEXT NOT NULL DEFAULT 'main'`,
  ]) {
    try {
      db.exec(stmt)
    } catch {
      /* column already exists */
    }
  }
  return db
}
