import { config } from 'dotenv'
import { join } from 'node:path'
import { REPO_ROOT } from './paths.js'

// Load the repo-root .env regardless of cwd (server runs with cwd=server/, CLI with cwd=root).
config({ path: join(REPO_ROOT, '.env') })
