// cluster.js — multi-process bootstrapper.
//
// Single-process startup is the default (see `npm start` → server/index.js).
// In production, run `node server/cluster.js` to fork one worker per CPU,
// share port 3000 across them, and respawn workers that die.
//
// IMPORTANT — workers do NOT share state. Two consequences for predIQ:
//
//   1. SSE (`/api/markets/:id/stream`) — `server/marketBus.js` is an
//      in-process EventEmitter. A trade handled by worker A only fans out
//      to subscribers connected to worker A. Until we add Redis pub/sub,
//      ensure your load balancer pins each user's stream connection to a
//      single worker (e.g. nginx `ip_hash` upstream, or sticky-session
//      cookies on a higher-level LB).
//
//   2. Rate limiter buckets are per-process. A 120/min trade limit becomes
//      effectively (120 * worker_count)/min in aggregate. That's usually
//      fine — the limit is for abuse defense, not exact metering — but
//      worth knowing. Move to Redis (atomic INCR + EXPIRE) when exact
//      cross-process accounting matters.
//
// Sessions are already stored in the DB (Session table), so worker
// boundaries don't affect login state.

const cluster = require('node:cluster')
const os = require('node:os')

if (cluster.isPrimary) {
  const desired = Number(process.env.WEB_CONCURRENCY) || os.cpus().length
  console.log(`cluster primary ${process.pid} forking ${desired} workers`)
  for (let i = 0; i < desired; i++) cluster.fork()

  cluster.on('exit', (worker, code, signal) => {
    console.error(`worker ${worker.process.pid} exited (code=${code} signal=${signal}); respawning`)
    cluster.fork()
  })

  // Graceful shutdown: kill all workers on SIGTERM/SIGINT.
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      console.log(`primary received ${sig}, shutting down workers`)
      for (const id in cluster.workers) cluster.workers[id].kill(sig)
      // Give workers a moment to flush, then exit.
      setTimeout(() => process.exit(0), 5_000).unref()
    })
  }
} else {
  require('./index.js')
}
