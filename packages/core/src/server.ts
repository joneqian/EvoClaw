import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import { chatRoutes } from './routes/chat.js'
import { healthRoutes } from './routes/health.js'
import { agentRoutes } from './routes/agents.js'
import { permissionRoutes } from './routes/permissions.js'
import { initDatabase, closeDatabase, flushDatabase } from './infrastructure/db/sqlite-store.js'
import { runMigrations } from './infrastructure/db/migration-runner.js'

const app = new Hono()

// Auth middleware: verify Bearer token
const EXPECTED_TOKEN = process.env['EVOCLAW_TOKEN']

app.use('*', cors({ origin: '*' }))

app.use('/api/*', async (c, next) => {
  if (!EXPECTED_TOKEN) {
    return next()
  }
  const auth = c.req.header('Authorization')
  if (auth !== `Bearer ${EXPECTED_TOKEN}`) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  return next()
})

// Routes
app.route('/api/chat', chatRoutes)
app.route('/api/health', healthRoutes)
app.route('/api/agents', agentRoutes)
app.route('/api/permissions', permissionRoutes)

// Start server
const port = parseInt(process.env['EVOCLAW_PORT'] || '3721', 10)

async function main() {
  const db = initDatabase()
  runMigrations(db)

  // Periodic flush: encrypt DB to disk every 60s
  const flushInterval = setInterval(() => {
    try { flushDatabase() } catch { /* ignore flush errors */ }
  }, 60_000)

  // Graceful shutdown: flush + close DB
  const shutdown = () => {
    clearInterval(flushInterval)
    closeDatabase()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
    console.log(`EvoClaw Sidecar running on http://127.0.0.1:${info.port}`)
  })
}

main().catch((err) => {
  console.error('Failed to start EvoClaw Sidecar:', err)
  process.exit(1)
})

export { app }
