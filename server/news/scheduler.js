// scheduler.js — periodic in-process trigger for the news → drafts pipeline.
//
// Why in-process: this is a small app and there's no separate worker tier.
// The tradeoff is that ingest runs share CPU + DB connections with the user-
// facing API. The work is mostly I/O-bound (HTTP fetches + Mistral API),
// so it's fine at low scale; revisit when you outgrow one node process.
//
// Single-flight: if a tick fires while a previous run is still executing
// (e.g. Mistral is rate-limited and the run takes longer than the
// interval), we skip rather than queue. Queueing here would let runs
// pile up unbounded under sustained slowness.
//
// Cold-start: we DO run a tick immediately on start so a fresh process
// gets fresh news without waiting for the first interval to elapse. Set
// `runOnStart: false` to disable.

const { ingestAll } = require('./ingest')
const { draftPending } = require('./draft')

function start({
  prisma,
  intervalMs,
  runOnStart = true,
  onTick = null,            // optional callback(result) for tests / metrics
} = {}) {
  if (!prisma) throw new Error('scheduler.start requires prisma')
  if (!Number.isFinite(intervalMs) || intervalMs < 1000) {
    throw new Error(`intervalMs must be ≥ 1000, got ${intervalMs}`)
  }

  let running = false
  let stopped = false

  const tick = async () => {
    if (stopped) return
    if (running) {
      console.log('[scheduler] previous tick still running — skipping')
      return
    }
    running = true
    const startedAt = Date.now()
    try {
      const ingest = await ingestAll(prisma)
      const draft = await draftPending(prisma)
      const durationMs = Date.now() - startedAt
      console.log(`[scheduler] tick ok — newItems=${ingest.newItems} drafts=${draft.draftsCreated} took=${durationMs}ms`)
      if (onTick) onTick({ ingest, draft, durationMs })
    } catch (e) {
      console.error('[scheduler] tick failed:', e?.message ?? e)
      if (onTick) onTick({ error: e?.message ?? String(e) })
    } finally {
      running = false
    }
  }

  const handle = setInterval(tick, intervalMs)
  // Don't keep the event loop alive solely for this timer — lets the
  // process exit cleanly on SIGINT/SIGTERM without explicit teardown.
  if (typeof handle.unref === 'function') handle.unref()

  if (runOnStart) {
    // Defer the cold-start tick by one event-loop turn so callers can
    // finish wiring (e.g. attach error handlers) before work begins.
    setImmediate(tick)
  }

  return function stop() {
    stopped = true
    clearInterval(handle)
  }
}

module.exports = { start }
