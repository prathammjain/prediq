// rateLimit.js — tiny in-process token-bucket rate limiter for sensitive
// endpoints (login, register).
//
// Why: brute-force protection. Without this, /api/auth/login is unbounded
// — bcrypt CPU is the only cost ceiling, but bcrypt work is async so the
// process can absorb thousands of concurrent guesses against a known
// handle.
//
// Single-process scope is fine for a one-node deploy. For multi-node, swap
// the in-memory Map for Redis (atomic INCR + EXPIRE).

const buckets = new Map()

// Periodically prune expired buckets so we don't leak memory under
// adversarial input. Hourly is fine — buckets are small.
const PRUNE_INTERVAL_MS = 60 * 60 * 1000
const pruneHandle = setInterval(() => {
  const now = Date.now()
  for (const [key, b] of buckets) {
    if (b.expiresAt < now) buckets.delete(key)
  }
}, PRUNE_INTERVAL_MS)
pruneHandle.unref?.()

// Limiter factory: returns Express middleware that allows `max` requests
// per `windowMs` for a key derived from req. Default key = req.ip.
// Under NODE_ENV=test the limiter is a no-op so test runs that hammer the
// same loopback IP don't get throttled into 429s — production behaviour is
// covered by dedicated tests in api.test.js where the limiter is the SUT.
function rateLimit({ windowMs, max, keyFn = (req) => req.ip ?? 'anon' }) {
  if (process.env.NODE_ENV === 'test') return (_req, _res, next) => next()
  return (req, res, next) => {
    const now = Date.now()
    const key = keyFn(req)
    let b = buckets.get(key)
    if (!b || b.expiresAt < now) {
      b = { count: 0, expiresAt: now + windowMs }
      buckets.set(key, b)
    }
    b.count += 1
    if (b.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((b.expiresAt - now) / 1000))
      res.setHeader('Retry-After', String(retryAfterSec))
      return res.status(429).json({
        error: `Too many requests — try again in ${retryAfterSec}s`,
        code: 'RATE_LIMITED',
      })
    }
    next()
  }
}

module.exports = { rateLimit }
