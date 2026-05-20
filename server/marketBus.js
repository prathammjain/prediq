// marketBus.js — tiny in-process pub/sub for price updates.
//
// Each Market gets a Set of subscribers (callbacks). publish() fans out
// the latest snapshot to every subscriber for that market. SSE handlers
// register a callback that writes an event to the response stream.
//
// In-process is fine for single-node deployments. If you ever scale to
// multiple Node processes, swap this for Redis pub/sub or Postgres
// LISTEN/NOTIFY — the public surface (subscribe / publish) stays the same.

const EventEmitter = require('node:events')

const bus = new EventEmitter()
bus.setMaxListeners(0)  // we may have many tabs subscribed to one market

function topic(marketId) {
  return `market:${Number(marketId)}`
}

// Subscribe to a market. Returns an unsubscribe function.
function subscribe(marketId, handler) {
  const t = topic(marketId)
  bus.on(t, handler)
  return () => bus.off(t, handler)
}

// Publish a snapshot to subscribers. `snapshot` should be a serializable
// object (typically { percents, sharesOutstanding, status, volume, t }).
function publish(marketId, snapshot) {
  bus.emit(topic(marketId), snapshot)
}

module.exports = { subscribe, publish }
