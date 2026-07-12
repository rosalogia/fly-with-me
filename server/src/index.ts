import './env.js'
import { getRequestListener } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { join, relative } from 'node:path'
import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { mcpHandler } from './api/mcp.js'
import { buildApp } from './api/routes.js'
import { openDb } from './db/db.js'
import { REPO_ROOT, dbPathFromEnv } from './paths.js'
import { getProvider } from './providers/index.js'

const dbPath = dbPathFromEnv()
const port = Number(process.env.PORT ?? 3000)

const db = openDb(dbPath)
const provider = getProvider()

const app = new Hono()

// Shared-password protection for group access (set SHARE_PASSWORD in .env).
// Registered before all routes so it covers the API and the UI. Two ways to
// present the same secret: HTTP basic auth (browsers), or a `?key=` query
// param — for AI assistants whose fetch tools cannot send headers.
const password = process.env.SHARE_PASSWORD
if (password) {
  const basic = basicAuth({ username: 'group', password })
  app.use('*', async (c, next) => {
    if (c.req.query('key') === password) return next()
    return basic(c, next)
  })
  console.log('[fly-with-me] auth enabled (basic user "group", or ?key=)')
}

app.route('/', buildApp({ db, provider }))

// Serve the built web UI when it exists (npm run build), so one port serves everything.
const webDist = join(REPO_ROOT, 'web', 'dist')
if (existsSync(join(webDist, 'index.html'))) {
  const root = relative(process.cwd(), webDist)
  app.use('/assets/*', serveStatic({ root }))
  app.use('/', serveStatic({ root, path: 'index.html' }))
  // Snapshot and trip links are client-side routes into the same SPA.
  app.use('/s/*', serveStatic({ root, path: 'index.html' }))
  app.use('/t/*', serveStatic({ root, path: 'index.html' }))
  app.use('/about', serveStatic({ root, path: 'index.html' }))
  console.log(`[fly-with-me] serving web UI from ${webDist}`)
}

// /mcp needs raw node req/res (MCP streamable-HTTP transport), so it's handled
// outside Hono — with the same shared-password check (?key= or basic auth).
const mcpAuthOk = (req: IncomingMessage): boolean => {
  if (!password) return true
  const url = new URL(req.url ?? '/', 'http://x')
  if (url.searchParams.get('key') === password) return true
  const header = req.headers.authorization
  if (header?.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
    return decoded === `group:${password}`
  }
  return false
}

const handleMcp = mcpHandler(db, provider)
const honoListener = getRequestListener(app.fetch)

const server = createServer((req, res) => {
  if (req.url?.startsWith('/mcp')) {
    if (!mcpAuthOk(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Basic realm="fly-with-me"' })
      res.end(JSON.stringify({ error: 'auth required: basic (group/<password>) or ?key=<password>' }))
      return
    }
    void handleMcp(req, res)
    return
  }
  void honoListener(req, res)
})

server.listen(port, () => {
  console.log(`[fly-with-me] API on http://localhost:${port} (provider: ${provider.name}, db: ${dbPath}, mcp: /mcp)`)
})
