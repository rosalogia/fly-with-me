import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repo root (this file lives at server/src/paths.ts). */
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** DB path from env (relative paths resolve against the repo root, not cwd). */
export function dbPathFromEnv(): string {
  const p = process.env.DB_PATH ?? 'data/cache.db'
  return isAbsolute(p) ? p : join(REPO_ROOT, p)
}
