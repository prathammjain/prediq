// server/index.js — predIQ API.
//
// Pipeline: cookie-parser → attachUser → route → validate → handler →
// typed-error → central error handler.
//
// Public routes (no auth):
//   GET  /api/markets, /api/markets/:id, /api/leaderboard
//   GET  /api/users/:user/scoring | /calibration | /badges     (public profile)
//   POST /api/auth/register, /api/auth/login
//   POST /api/markets/:id/preview                              (read-only sim)
//
// Authenticated routes (req.user must exist):
//   GET  /api/auth/me, /api/me/balance, /api/me/positions,
//        /api/me/transactions
//   POST /api/auth/logout, /api/me/bonus
//   POST /api/markets, /api/markets/:id/trade,
//        /api/markets/:id/propose, /dispute, /finalize, /claim
//
// Admin override on `finalize` is handled inside marketService via
// req.user.role === 'ADMIN'.

require('dotenv').config()
// Config validation must run BEFORE any other module that touches process.env
// so a bad config dies at boot rather than serving broken traffic.
const { env } = require('./config')
const log = require('./logger')
const crypto = require('crypto')
const express = require('express')
const cookieParser = require('cookie-parser')
const path = require('path')
const svc = require('./marketService')
const { validate, schemas } = require('./validation')
const { AppError, ValidationError, ConflictError, UnauthorizedError } = require('./errors')
const auth = require('./auth')
const { rateLimit } = require('./rateLimit')
const newsIngest = require('./news/ingest')
const newsDraft = require('./news/draft')
const newsScheduler = require('./news/scheduler')
const bus = require('./marketBus')

const app = express()
const BOOTED_AT = Date.now()

// --- Middleware -------------------------------------------------------------
app.use(express.json({ limit: '64kb' }))
app.use(express.urlencoded({ extended: true, limit: '64kb' }))
app.use(cookieParser())

// Per-request ID. Echoed via the X-Request-Id header and surfaced in 500
// responses so users can quote it when reporting bugs. Trust an upstream
// proxy-provided header if present so a request keeps the same ID across
// reverse-proxy + app logs.
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomBytes(8).toString('hex')
  res.setHeader('X-Request-Id', req.id)
  next()
})

// Structured request log. Skips /health to keep aggregators clean. Logs on
// `finish` so we capture the response status + duration in one record.
app.use((req, res, next) => {
  if (req.path === '/health') return next()
  const t0 = Date.now()
  res.on('finish', () => {
    log.info('http', {
      reqId: req.id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - t0,
      user: req.user?.handle ?? null,
    })
  })
  next()
})

// Hydrate req.user (or null) from the session cookie.
app.use(auth.attachUser(svc.prisma))

// Serve the built Vite frontend if present.
app.use(express.static(path.join(__dirname, '../frontend-vite/dist')))

// --- Async wrapper ----------------------------------------------------------
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// =============================================================================
// AUTH
// =============================================================================
// Daily bonus cadence — must match marketService.DAILY_BONUS_COOLDOWN_MS.
const DAILY_BONUS_COOLDOWN_MS = 24 * 60 * 60 * 1000

function publicUser(u) {
  // Compute next-eligible-at so the UI can show a countdown without an
  // extra round-trip. null = available now.
  const last = u.lastBonusAt ? new Date(u.lastBonusAt).getTime() : null
  const next = last ? last + DAILY_BONUS_COOLDOWN_MS : null
  const bonusReady = !next || next <= Date.now()
  return {
    handle: u.handle,
    role: u.role,
    tier: u.tier,
    chipsBalance: u.chipsBalance,
    pasRating: Math.round(u.pasRating),
    createdAt: u.createdAt,
    lastBonusAt: u.lastBonusAt,
    nextBonusAt: bonusReady ? null : next,
    firstTradeAt: u.firstTradeAt,
  }
}

// =============================================================================
// RATE LIMITERS — declared once, applied to route groups below.
// =============================================================================
// Key strategy: when the request is authenticated, key on the user id (so a
// signed-in user's quota is shared across IPs/devices). When anonymous, fall
// back to IP. Each tier's window/max is sized for its blast radius:
//   • auth:        20 / 15 min per (ip+handle)   — bcrypt cost + brute force
//   • trade:       120 / minute per user          — high-volume by design
//   • resolution:  30 / 15 min per user           — propose/dispute/finalize/claim
//   • create:      10 / hour per user             — spam markets are expensive
//   • bonus:       60 / hour per user             — gated client-side but defended here
//   • adminIngest: 4 / hour per admin             — Mistral calls cost real money
const userKey = (prefix) => (req) => `${prefix}:${req.user?.id ?? 'ip:' + req.ip}`

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyFn: (req) => `auth:${req.ip}:${(req.body?.handle ?? '').toLowerCase()}`,
})
const tradeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyFn: userKey('trade'),
})
const resolutionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyFn: userKey('resolve'),
})
const createMarketLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyFn: userKey('create'),
})
const bonusLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  keyFn: userKey('bonus'),
})
const adminIngestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 4,
  keyFn: userKey('admin-ingest'),
})

app.post(
  '/api/auth/register',
  authLimiter,
  validate({ body: schemas.registerBody }),
  wrap(async (req, res) => {
    const { handle, password, email } = req.body
    const existing = await svc.prisma.user.findUnique({ where: { handle } })
    if (existing && existing.passwordHash) {
      throw new ConflictError('Handle already taken')
    }
    const passwordHash = await auth.hashPassword(password)

    let user
    if (existing) {
      // Pre-seeded handle (e.g. demo user) without a password yet — claim it.
      user = await svc.prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash, email: email ?? existing.email },
      })
    } else {
      // ensureUser also seeds the SIGNUP_BONUS into the ledger.
      user = await svc.ensureUser(handle)
      user = await svc.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, email },
      })
    }

    const session = await auth.createSession(svc.prisma, {
      userId: user.id,
      userAgent: req.get('user-agent') || null,
      ipAddress: req.ip,
    })
    auth.setSessionCookie(res, session.id, session.expiresAt)
    res.status(201).json({ user: publicUser(user) })
  })
)

app.post(
  '/api/auth/login',
  authLimiter,
  validate({ body: schemas.loginBody }),
  wrap(async (req, res) => {
    const { handle, password } = req.body
    const user = await svc.prisma.user.findUnique({ where: { handle } })
    // Constant-ish-time: always run a bcrypt compare so a non-existent
    // handle vs a wrong password take roughly the same wall-clock.
    const ok = user
      ? await auth.verifyPassword(password, user.passwordHash)
      : await auth.verifyPassword(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalida')
    if (!user || !ok) {
      throw new UnauthorizedError('Invalid credentials')
    }
    const session = await auth.createSession(svc.prisma, {
      userId: user.id,
      userAgent: req.get('user-agent') || null,
      ipAddress: req.ip,
    })
    auth.setSessionCookie(res, session.id, session.expiresAt)
    res.json({ user: publicUser(user) })
  })
)

app.post(
  '/api/auth/logout',
  wrap(async (req, res) => {
    if (req.session?.id) {
      await auth.destroySession(svc.prisma, req.session.id)
    }
    auth.clearSessionCookie(res)
    res.status(204).end()
  })
)

app.get(
  '/api/auth/me',
  wrap(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in required', code: 'UNAUTHORIZED' })
    res.json({ user: publicUser(req.user) })
  })
)

// Surfaces auth provider availability so the frontend can hide the Google
// button when GOOGLE_CLIENT_ID isn't set (local dev without OAuth configured).
app.get('/api/auth/providers', (_req, res) => {
  res.json({
    google: {
      enabled: auth.isGoogleConfigured(),
      clientId: auth.isGoogleConfigured() ? process.env.GOOGLE_CLIENT_ID : null,
    },
  })
})

// Google sign-in. The frontend obtains an ID token via Google Identity
// Services (one-tap or button), POSTs it here, and we:
//   1. Verify the token's signature + audience against Google's JWKS.
//   2. Look up by googleId → existing linked account.
//   3. Else look up by verified email → link Google to that account.
//   4. Else create a new account with a derived handle and a SIGNUP_BONUS.
//
// Issues a session cookie on success (same shape as register/login).
const googleAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyFn: (req) => `google:${req.ip}`,
})

app.post(
  '/api/auth/google',
  googleAuthLimiter,
  validate({ body: schemas.googleAuthBody }),
  wrap(async (req, res) => {
    const payload = await auth.verifyGoogleIdToken(req.body.idToken)
    const { sub: googleId, email, email_verified: emailVerified } = payload

    let user = await svc.prisma.user.findUnique({ where: { googleId } })

    if (!user && email && emailVerified) {
      // Link Google to an existing account that matches the verified email.
      const byEmail = await svc.prisma.user.findUnique({ where: { email } })
      if (byEmail) {
        user = await svc.prisma.user.update({
          where: { id: byEmail.id },
          data: { googleId },
        })
      }
    }

    if (!user) {
      // Brand-new user. Derive a handle, run through ensureUser so the
      // SIGNUP_BONUS gets credited via the normal ledger path.
      const handle = await auth.deriveUniqueHandle(svc.prisma, email)
      user = await svc.ensureUser(handle)
      user = await svc.prisma.user.update({
        where: { id: user.id },
        data: {
          googleId,
          email: emailVerified ? email : null,
        },
      })
    }

    const session = await auth.createSession(svc.prisma, {
      userId: user.id,
      userAgent: req.get('user-agent') || null,
      ipAddress: req.ip,
    })
    auth.setSessionCookie(res, session.id, session.expiresAt)
    res.json({ user: publicUser(user) })
  })
)

// =============================================================================
// MARKETS
// =============================================================================
app.get(
  '/api/markets',
  validate({ query: schemas.listMarketsQuery }),
  wrap(async (req, res) => {
    res.json(await svc.listMarkets({
      category: req.query.category,
      sort: req.query.sort,
      limit: req.query.limit,
    }))
  })
)

app.get(
  '/api/markets/:id',
  validate({ params: schemas.marketIdParams }),
  wrap(async (req, res) => {
    const m = await svc.getMarket(req.params.id)
    if (!m) return res.status(404).json({ error: 'Market not found', code: 'NOT_FOUND' })
    res.json(m)
  })
)

app.post(
  '/api/markets',
  auth.requireAuth,
  createMarketLimiter,
  validate({ body: schemas.createMarketBody }),
  wrap(async (req, res) => {
    const marketId = await svc.createMarket({
      description: req.body.description,
      endTime: req.body.endTime,
      ownerHandle: req.user.handle,
      outcomes: req.body.outcomes,
      category: req.body.category,
      resolutionSource: req.body.resolutionSource,
      imageUrl: req.body.imageUrl,
      liquidityB: req.body.liquidityB,
      useLsLmsr: req.body.useLsLmsr,
      lsAlpha: req.body.lsAlpha,
    })
    res.status(201).json({ marketId })
  })
)

// Server-Sent Events: stream live price + status updates for a market.
// Client EventSource connects, gets a `connected` event with the current
// snapshot, then any subsequent `price` / `status` events as trades or
// resolution actions occur.
//
// Heartbeats every 25s as SSE comments to keep proxies (nginx, Cloudflare)
// from killing the connection.
app.get('/api/markets/:id/stream', wrap(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id < 1) return res.status(400).end()

  // Ensure the market exists. Cheaper than streaming an error.
  const exists = await svc.prisma.market.findUnique({ where: { id }, select: { id: true } })
  if (!exists) return res.status(404).end()

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders()
  // Disable Nagle's algorithm so each write hits the wire immediately.
  res.socket?.setNoDelay?.(true)
  // First write triggers the chunked-encoding response framing in some
  // proxies/clients; send a comment to flush headers + open the stream.
  res.write(': ok\n\n')

  // Send the current snapshot immediately so the UI doesn't wait for the
  // next trade to populate.
  const state = await svc.getMarketState(id)
  if (state) {
    const initial = {
      kind: 'snapshot',
      percents: state.pricesVec,
      sharesOutstanding: state.q,
      status: state.market.status,
      t: Date.now(),
    }
    res.write(`event: snapshot\ndata: ${JSON.stringify(initial)}\n\n`)
  }

  const send = (msg) => {
    res.write(`event: ${msg.kind}\ndata: ${JSON.stringify(msg)}\n\n`)
  }
  const unsubscribe = bus.subscribe(id, send)

  const heartbeat = setInterval(() => {
    res.write(`: ping ${Date.now()}\n\n`)
  }, 25_000)
  heartbeat.unref?.()

  req.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })
}))

app.post(
  '/api/markets/:id/preview',
  validate({ params: schemas.marketIdParams, body: schemas.previewBody }),
  wrap(async (req, res) => {
    const result = await svc.previewTrade({
      marketId: req.params.id,
      outcomeIndex: req.body.outcome,
      chips: req.body.chips,
    })
    res.json(result)
  })
)

app.post(
  '/api/markets/:id/trade',
  auth.requireAuth,
  tradeLimiter,
  validate({ params: schemas.marketIdParams, body: schemas.tradeBody }),
  wrap(async (req, res) => {
    const result = await svc.tradeBuy({
      userHandle: req.user.handle,
      marketId: req.params.id,
      outcomeIndex: req.body.outcome,
      chips: req.body.chips,
    })
    res.json({ ok: true, ...result })
  })
)

app.post(
  '/api/markets/:id/sell-preview',
  validate({ params: schemas.marketIdParams, body: schemas.previewSellBody }),
  wrap(async (req, res) => {
    const result = await svc.previewSell({
      marketId: req.params.id,
      outcomeIndex: req.body.outcome,
      shares: req.body.shares,
    })
    res.json(result)
  })
)

app.post(
  '/api/markets/:id/sell',
  auth.requireAuth,
  tradeLimiter,
  validate({ params: schemas.marketIdParams, body: schemas.sellBody }),
  wrap(async (req, res) => {
    const result = await svc.tradeSell({
      userHandle: req.user.handle,
      marketId: req.params.id,
      outcomeIndex: req.body.outcome,
      shares: req.body.shares,
    })
    res.json({ ok: true, ...result })
  })
)

app.post(
  '/api/markets/:id/propose',
  auth.requireAuth,
  resolutionLimiter,
  validate({ params: schemas.marketIdParams, body: schemas.proposeBody }),
  wrap(async (req, res) => {
    await svc.proposeResolution({
      userHandle: req.user.handle,
      marketId: req.params.id,
      outcomeIndex: req.body.outcome,
    })
    res.json({ ok: true })
  })
)

app.post(
  '/api/markets/:id/dispute',
  auth.requireAuth,
  resolutionLimiter,
  validate({ params: schemas.marketIdParams, body: schemas.disputeBody }),
  wrap(async (req, res) => {
    await svc.disputeResolution({
      userHandle: req.user.handle,
      marketId: req.params.id,
    })
    res.json({ ok: true })
  })
)

app.post(
  '/api/markets/:id/finalize',
  auth.requireAuth,
  resolutionLimiter,
  validate({ params: schemas.marketIdParams, body: schemas.finalizeBody }),
  wrap(async (req, res) => {
    const result = await svc.finalizeResolution({
      userHandle: req.user.handle,
      marketId: req.params.id,
      adminOutcomeIndex: req.body.outcome,
    })
    res.json({ ok: true, ...result })
  })
)

app.post(
  '/api/markets/:id/claim',
  auth.requireAuth,
  resolutionLimiter,
  validate({ params: schemas.marketIdParams, body: schemas.claimBody }),
  wrap(async (req, res) => {
    const result = await svc.claimPayout({
      userHandle: req.user.handle,
      marketId: req.params.id,
    })
    res.json({ ok: true, ...result })
  })
)

// =============================================================================
// USERS — public profile data (anyone can view)
// =============================================================================
app.get(
  '/api/users/:user/scoring',
  validate({ params: schemas.userParams }),
  wrap(async (req, res) => {
    res.json(await svc.getScoringReport(req.params.user))
  })
)

app.get(
  '/api/users/:user/calibration',
  validate({ params: schemas.userParams, query: schemas.calibrationQuery }),
  wrap(async (req, res) => {
    res.json(await svc.getCalibrationReport(req.params.user, req.query.bins))
  })
)

app.get(
  '/api/users/:user/badges',
  validate({ params: schemas.userParams }),
  wrap(async (req, res) => {
    res.json(await svc.getBadges(req.params.user))
  })
)

// =============================================================================
// ME — self-scoped private data (auth required, always for req.user)
// =============================================================================
app.get(
  '/api/me/balance',
  auth.requireAuth,
  wrap(async (req, res) => {
    res.json({ balance: await svc.getBalance(req.user.handle) })
  })
)

app.get(
  '/api/me/positions',
  auth.requireAuth,
  wrap(async (req, res) => {
    res.json(await svc.getPositions(req.user.handle))
  })
)

// Lifecycle action surface — claimable payouts, markets you own that are
// waiting on a propose, dispute windows that are open on your stakes.
// Powers the Action Center on Portfolio and the nav-badge dot.
app.get(
  '/api/me/actions',
  auth.requireAuth,
  wrap(async (req, res) => {
    res.json(await svc.getLifecycleActions(req.user.handle))
  })
)

// Claim every unclaimed winning position in one transaction. Returns the
// per-call totals so the UI can toast a single summary instead of one per
// market.
app.post(
  '/api/me/claim-all',
  auth.requireAuth,
  wrap(async (req, res) => {
    res.json(await svc.claimAllPayouts(req.user.handle))
  })
)

app.get(
  '/api/me/transactions',
  auth.requireAuth,
  validate({ query: schemas.transactionsQuery }),
  wrap(async (req, res) => {
    res.json(await svc.getTransactions(req.user.handle, req.query.limit))
  })
)

app.post(
  '/api/me/bonus',
  auth.requireAuth,
  bonusLimiter,
  wrap(async (req, res) => {
    res.json(await svc.claimDailyBonus(req.user.handle))
  })
)

// =============================================================================
// ADMIN — RSS ingest + draft review
// =============================================================================
// Runs RSS ingest, then the draft generator over any newly-fetched items.
// Returns counters so the admin UI can show "ingested 42, drafted 38".
app.post(
  '/api/admin/news/ingest',
  auth.requireAdmin,
  adminIngestLimiter,
  wrap(async (_req, res) => {
    const ingest = await newsIngest.ingestAll(svc.prisma)
    const draft = await newsDraft.draftPending(svc.prisma)
    res.json({ ingest, draft })
  })
)

app.get(
  '/api/admin/drafts',
  auth.requireAdmin,
  wrap(async (req, res) => {
    const status = req.query.status ?? 'PENDING'
    const take = Math.min(Math.max(Number(req.query.take) || 25, 1), 100)
    const cursor = req.query.cursor ? Number(req.query.cursor) : undefined
    // Cursor-based pagination — pass `cursor` (last draft id seen) to get
    // the next page. Total returned = take. nextCursor=null means end.
    const drafts = await svc.prisma.marketDraft.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
      take: take + 1,                 // overfetch by 1 to detect "more"
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { newsItem: true },
    })
    const hasMore = drafts.length > take
    const page = hasMore ? drafts.slice(0, take) : drafts
    res.json({
      items: page.map(d => ({ ...d, outcomes: JSON.parse(d.outcomes) })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    })
  })
)

app.post(
  '/api/admin/drafts/:id/approve',
  auth.requireAdmin,
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) throw new ValidationError('Invalid draft id')
    const draft = await svc.prisma.marketDraft.findUnique({ where: { id } })
    if (!draft) return res.status(404).json({ error: 'Draft not found', code: 'NOT_FOUND' })
    if (draft.status !== 'PENDING') throw new ConflictError(`Draft already ${draft.status.toLowerCase()}`)

    // Body may override any field. Falls back to the draft's stored value.
    const body = req.body ?? {}
    const outcomes = body.outcomes ?? JSON.parse(draft.outcomes)
    const marketId = await svc.createMarket({
      description: body.description ?? draft.description,
      endTime: body.endTime ?? draft.endTime.getTime(),
      ownerHandle: req.user.handle,
      outcomes,
      category: body.category ?? draft.category,
      resolutionSource: body.resolutionSource ?? draft.resolutionSource,
      liquidityB: body.liquidityB ?? draft.liquidityB,
      useLsLmsr: body.useLsLmsr ?? draft.useLsLmsr,
      lsAlpha: body.lsAlpha ?? draft.lsAlpha,
    })

    await svc.prisma.marketDraft.update({
      where: { id },
      data: {
        status: 'APPROVED',
        reviewedAt: new Date(),
        reviewedByHandle: req.user.handle,
        approvedMarketId: marketId,
      },
    })
    res.status(201).json({ marketId })
  })
)

// Bulk-reject by ID array. Useful for clearing out a batch of low-quality
// drafts (e.g. the Slice-1 placeholders) in one transaction.
app.post(
  '/api/admin/drafts/bulk-reject',
  auth.requireAdmin,
  wrap(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : []
    if (!ids.length) throw new ValidationError('ids must be a non-empty array of integers')
    const result = await svc.prisma.marketDraft.updateMany({
      where: { id: { in: ids }, status: 'PENDING' },
      data: {
        status: 'REJECTED',
        reviewedAt: new Date(),
        reviewedByHandle: req.user.handle,
      },
    })
    res.json({ rejected: result.count })
  })
)

app.post(
  '/api/admin/drafts/:id/reject',
  auth.requireAdmin,
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) throw new ValidationError('Invalid draft id')
    const draft = await svc.prisma.marketDraft.findUnique({ where: { id } })
    if (!draft) return res.status(404).json({ error: 'Draft not found', code: 'NOT_FOUND' })
    if (draft.status !== 'PENDING') throw new ConflictError(`Draft already ${draft.status.toLowerCase()}`)

    await svc.prisma.marketDraft.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewedAt: new Date(),
        reviewedByHandle: req.user.handle,
      },
    })
    res.json({ ok: true })
  })
)

// =============================================================================
// LEADERBOARD
// =============================================================================
app.get(
  '/api/leaderboard',
  validate({ query: schemas.leaderboardQuery }),
  wrap(async (req, res) => {
    res.json(await svc.getLeaderboard({ by: req.query.by, limit: req.query.limit }))
  })
)

// =============================================================================
// HEALTH + 404 + ERROR HANDLER
// =============================================================================
// Deep health check. Pings the DB so load balancers can detect a stuck
// process whose Postgres pool has died. Returns 503 on DB failure so the
// orchestrator can replace the container.
app.get('/health', async (_req, res) => {
  const t0 = Date.now()
  try {
    await svc.prisma.$queryRaw`SELECT 1`
    res.json({
      ok: true,
      uptimeMs: Date.now() - BOOTED_AT,
      dbMs: Date.now() - t0,
      env: env.NODE_ENV,
    })
  } catch (e) {
    log.error('health.db_ping_failed', { err: e })
    res.status(503).json({
      ok: false,
      uptimeMs: Date.now() - BOOTED_AT,
      error: 'database unreachable',
    })
  }
})

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' })
})

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err instanceof AppError) {
    const body = { error: err.message, code: err.code }
    if (err.details) body.details = err.details
    return res.status(err.statusCode).json(body)
  }
  // Unexpected: log with request context so we can correlate later, and
  // surface the request ID to the client so users can quote it.
  log.error('unhandled', {
    reqId: req.id,
    method: req.method,
    path: req.path,
    user: req.user?.handle ?? null,
    err,
  })
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL',
    requestId: req.id,
  })
})

// =============================================================================
// SEED
// =============================================================================
async function seedBadges() {
  const defaults = [
    { slug: 'first_correct', name: 'First Blood', description: 'Win your first prediction.', conditionType: 'STREAK', threshold: 1, iconName: 'spark' },
    { slug: 'streak_5', name: 'Hot Hand', description: '5 correct predictions in a row.', conditionType: 'STREAK', threshold: 5, iconName: 'flame' },
    { slug: 'streak_10', name: 'On Fire', description: '10 correct predictions in a row.', conditionType: 'STREAK', threshold: 10, iconName: 'flame-double' },
    { slug: 'pas_1700', name: 'Sharp', description: 'Reach a PAS rating of 1700.', conditionType: 'PAS', threshold: 1700, iconName: 'target' },
    { slug: 'pas_2000', name: 'Oracle', description: 'Reach a PAS rating of 2000.', conditionType: 'PAS', threshold: 2000, iconName: 'crown' },
    { slug: 'volume_10k', name: 'Whale', description: 'Stake 10,000 lifetime chips.', conditionType: 'VOLUME', threshold: 10000, iconName: 'wave' },
    { slug: 'calibrated', name: 'Well Calibrated', description: 'ECE under 0.05 over 50+ trades.', conditionType: 'CALIBRATION', threshold: 0.05, iconName: 'scale' },
    { slug: 'contrarian_win', name: 'Contrarian', description: 'Win a trade you placed at < 25% probability.', conditionType: 'SPECIAL', iconName: 'arrow-down-up' },
  ]
  for (const b of defaults) {
    await svc.prisma.badge.upsert({ where: { slug: b.slug }, create: b, update: b })
  }
}

// Seed demo users with `demo123` password so the app is usable out of the
// box. `admin` becomes ADMIN-role. Idempotent: existing users only get
// their password set if they don't already have one.
const DEMO_USERS = [
  { handle: 'Alice', role: 'USER' },
  { handle: 'Bob', role: 'USER' },
  { handle: 'Carol', role: 'USER' },
  { handle: 'Dev', role: 'USER' },
  { handle: 'Priya', role: 'USER' },
  { handle: 'admin', role: 'ADMIN' },
]
const DEMO_PASSWORD = env.DEMO_PASSWORD

async function seedDemoUsers() {
  const demoHash = await auth.hashPassword(DEMO_PASSWORD)
  for (const { handle, role } of DEMO_USERS) {
    const u = await svc.ensureUser(handle)
    if (!u.passwordHash || u.role !== role) {
      await svc.prisma.user.update({
        where: { id: u.id },
        data: {
          passwordHash: u.passwordHash || demoHash,
          role,
        },
      })
    }
  }
}

async function seed() {
  await seedBadges()
  await seedDemoUsers()
  const existing = await svc.listMarkets()
  if (existing.length > 0) return

  const day = 24 * 60 * 60 * 1000
  const now = Date.now()
  const samples = [
    { description: 'Will India win the next IPL final?', category: 'Cricket', outcomes: ['Yes', 'No'], endIn: 30 * day, resolutionSource: 'Official IPL match result published by BCCI.' },
    { description: 'Will the central bank cut rates at the next policy meeting?', category: 'Economy', outcomes: ['Cut', 'Hold', 'Hike'], endIn: 14 * day, resolutionSource: 'Official monetary policy committee announcement.' },
    { description: 'Will the benchmark index close above 25,000 by month end?', category: 'Markets', outcomes: ['Yes', 'No'], endIn: 20 * day, resolutionSource: 'Official closing price on the last trading day.' },
    { description: 'Who wins the next reality-TV finale?', category: 'Entertainment', outcomes: ['Contestant A', 'Contestant B', 'Contestant C', 'Other'], endIn: 60 * day, resolutionSource: 'Official broadcast finale result.' },
    { description: 'Will ISRO launch a crewed mission this year?', category: 'Science', outcomes: ['Yes', 'No'], endIn: 90 * day, resolutionSource: 'Official space agency press release.' },
    { description: 'Will India qualify for FIFA World Cup 2030?', category: 'Football', outcomes: ['Yes', 'No'], endIn: 365 * day, resolutionSource: 'AFC qualification standings published by FIFA.' },
  ]
  for (const s of samples) {
    await svc.createMarket({
      description: s.description,
      endTime: now + s.endIn,
      ownerHandle: 'admin',
      outcomes: s.outcomes,
      category: s.category,
      resolutionSource: s.resolutionSource,
    })
  }
  log.info('seed.markets', { count: samples.length })
}

// --- Boot -------------------------------------------------------------------
const PORT = env.PORT

if (require.main === module) {
  seed()
    .then(() => {
      app.listen(PORT, () => {
        // Single startup record summarising what's wired up. Reading this
        // one line should tell ops what mode the process is in and which
        // optional features are active.
        log.info('boot', {
          port: PORT,
          env: env.NODE_ENV,
          node: process.version,
          mistral: env.hasMistral,
          googleOAuth: env.hasGoogleOAuth,
          newsScheduler: env.newsSchedulerEnabled
            ? `every ${env.NEWS_INGEST_INTERVAL_MIN}m`
            : 'disabled',
        })
      })
      // News pipeline cron — opt-in via NEWS_INGEST_INTERVAL_MIN. Set to a
      // positive integer (minutes) to run RSS ingest + Mistral drafting on
      // a schedule. Recommended: 360 (every 6 hours). Unset/0 = disabled,
      // which is the right default for tests and dev environments.
      if (env.newsSchedulerEnabled) {
        newsScheduler.start({
          prisma: svc.prisma,
          intervalMs: env.NEWS_INGEST_INTERVAL_MIN * 60_000,
        })
      }
    })
    .catch((e) => {
      log.error('boot.seed_failed', { err: e })
      process.exit(1)
    })
}

module.exports = { app, seed, seedBadges, seedDemoUsers, DEMO_PASSWORD }
