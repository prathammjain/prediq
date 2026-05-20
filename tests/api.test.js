// API integration tests. Every authenticated request goes through a
// supertest agent that holds the session cookie issued at login. Each
// `it()` starts on a freshly truncated DB.

const { execSync } = require('child_process')
const fs = require('fs')
const request = require('supertest')

const { app, seedBadges, seedDemoUsers, DEMO_PASSWORD } = require('../server/index')
const svc = require('../server/marketService')

// ---------- DB lifecycle ---------------------------------------------------
beforeAll(() => {
  execSync('npx prisma db push --accept-data-loss --skip-generate', {
    stdio: 'pipe',
    env: { ...process.env },
  })
})

afterAll(async () => {
  await svc.prisma.$disconnect()
  const m = (process.env.DATABASE_URL || '').match(/^file:(.+)$/)
  if (m && fs.existsSync(m[1])) {
    try { fs.unlinkSync(m[1]) } catch (_) {}
  }
})

beforeEach(async () => {
  const p = svc.prisma
  await p.session.deleteMany()
  await p.userBadge.deleteMany()
  await p.coinTransaction.deleteMany()
  await p.priceSnapshot.deleteMany()
  await p.trade.deleteMany()
  await p.sharePosition.deleteMany()
  await p.outcome.deleteMany()
  await p.market.deleteMany()
  await p.user.deleteMany()
  await p.badge.deleteMany()
})

// ---------- Helpers --------------------------------------------------------
async function setupDemo() {
  // Seeds badges + demo users (Alice, Bob, Carol, Dev, Priya, admin).
  await seedBadges()
  await seedDemoUsers()
}

async function loginAs(handle, password = DEMO_PASSWORD) {
  const agent = request.agent(app)
  const res = await agent
    .post('/api/auth/login')
    .send({ handle, password })
    .expect(200)
  return { agent, user: res.body.user }
}

async function createBinaryMarket(agent, { description = 'Will it rain tomorrow?', endIn = 7 * 86_400_000 } = {}) {
  const res = await agent
    .post('/api/markets')
    .send({
      description,
      endTime: Date.now() + endIn,
      outcomes: ['Yes', 'No'],
      category: 'Test',
      resolutionSource: 'Test source.',
    })
    .expect(201)
  return res.body.marketId
}

async function ledgerInvariant(handle) {
  const u = await svc.prisma.user.findUnique({ where: { handle } })
  const sum = await svc.prisma.coinTransaction.aggregate({
    where: { userId: u.id }, _sum: { amount: true },
  })
  return { balance: u.chipsBalance, ledgerSum: sum._sum.amount ?? 0 }
}

// ===========================================================================
// AUTH
// ===========================================================================
describe('Auth', () => {
  it('register issues a session cookie and seeds the user', async () => {
    const agent = request.agent(app)
    const res = await agent
      .post('/api/auth/register')
      .send({ handle: 'NewUser', password: 'super-secret' })
      .expect(201)
    expect(res.body.user.handle).toBe('NewUser')
    expect(res.body.user.role).toBe('USER')
    // Cookie set
    expect(res.headers['set-cookie'].some(c => /prediq_session=/.test(c))).toBe(true)
    // Subsequent /me works
    const me = await agent.get('/api/auth/me').expect(200)
    expect(me.body.user.handle).toBe('NewUser')
  })

  it('rejects duplicate handle registration', async () => {
    await request(app).post('/api/auth/register').send({ handle: 'Dup', password: 'aaaaaaaa' }).expect(201)
    const res = await request(app).post('/api/auth/register').send({ handle: 'Dup', password: 'bbbbbbbb' }).expect(409)
    expect(res.body.code).toBe('CONFLICT')
  })

  it('rejects short password', async () => {
    const res = await request(app).post('/api/auth/register').send({ handle: 'Short', password: 'aa' }).expect(400)
    expect(res.body.code).toBe('VALIDATION')
  })

  it('login fails for wrong password', async () => {
    await request(app).post('/api/auth/register').send({ handle: 'Pat', password: 'correctpass' }).expect(201)
    const res = await request(app).post('/api/auth/login').send({ handle: 'Pat', password: 'wrongpass' }).expect(401)
    expect(res.body.code).toBe('UNAUTHORIZED')
  })

  it('login fails for unknown handle (constant-time-ish)', async () => {
    const res = await request(app).post('/api/auth/login').send({ handle: 'Ghost', password: 'whatever' }).expect(401)
    expect(res.body.code).toBe('UNAUTHORIZED')
  })

  it('logout invalidates the session', async () => {
    await setupDemo()
    const { agent } = await loginAs('Alice')
    await agent.get('/api/auth/me').expect(200)
    await agent.post('/api/auth/logout').expect(204)
    await agent.get('/api/auth/me').expect(401)
  })

  it('/api/auth/me returns 401 without a session', async () => {
    await request(app).get('/api/auth/me').expect(401)
  })

  it('demo user can sign in with seeded password', async () => {
    await setupDemo()
    const { user } = await loginAs('Alice')
    expect(user.handle).toBe('Alice')
  })
})

// ===========================================================================
// AUTHORIZATION
// ===========================================================================
describe('Authorization', () => {
  beforeEach(setupDemo)

  it('rejects unauthenticated trade', async () => {
    const { agent } = await loginAs('admin')
    const id = await createBinaryMarket(agent)
    const res = await request(app)
      .post(`/api/markets/${id}/trade`)
      .send({ outcome: 0, chips: 100 })
      .expect(401)
    expect(res.body.code).toBe('UNAUTHORIZED')
  })

  it('rejects unauthenticated market creation', async () => {
    const res = await request(app)
      .post('/api/markets')
      .send({
        description: 'No auth attempt to create.',
        endTime: Date.now() + 86_400_000,
        outcomes: ['Yes', 'No'],
      })
      .expect(401)
    expect(res.body.code).toBe('UNAUTHORIZED')
  })

  it('rejects /api/me/* without a session', async () => {
    await request(app).get('/api/me/balance').expect(401)
    await request(app).get('/api/me/positions').expect(401)
    await request(app).post('/api/me/bonus').expect(401)
  })

  it('non-creator non-admin cannot propose resolution', async () => {
    const { agent: adminAgent } = await loginAs('admin')
    const id = await createBinaryMarket(adminAgent)

    const { agent: aliceAgent } = await loginAs('Alice')
    const res = await aliceAgent
      .post(`/api/markets/${id}/propose`)
      .send({ outcome: 0 })
      .expect(403)
    expect(res.body.code).toBe('FORBIDDEN')
  })

  it('admin can finalize via override path', async () => {
    const { agent: adminAgent } = await loginAs('admin')
    const id = await createBinaryMarket(adminAgent)
    await adminAgent.post(`/api/markets/${id}/propose`).send({ outcome: 0 }).expect(200)
    const res = await adminAgent.post(`/api/markets/${id}/finalize`).send({ outcome: 0 }).expect(200)
    expect(res.body.resolvedOutcomeIndex).toBe(0)
  })
})

// ===========================================================================
// PUBLIC SURFACE
// ===========================================================================
describe('Public endpoints (no auth)', () => {
  beforeEach(setupDemo)

  it('GET /api/markets is public', async () => {
    const { agent } = await loginAs('admin')
    await createBinaryMarket(agent)
    const res = await request(app).get('/api/markets').expect(200)
    expect(res.body.length).toBe(1)
  })

  it('GET /api/users/:user/scoring is public profile data', async () => {
    const res = await request(app).get('/api/users/Alice/scoring').expect(200)
    expect(res.body.user).toBe('Alice')
  })

  it('GET /api/leaderboard is public', async () => {
    const res = await request(app).get('/api/leaderboard?by=balance').expect(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('preview is public (read-only sim)', async () => {
    const { agent } = await loginAs('admin')
    const id = await createBinaryMarket(agent)
    const res = await request(app)
      .post(`/api/markets/${id}/preview`)
      .send({ outcome: 0, chips: 100 })
      .expect(200)
    expect(res.body.shares).toBeGreaterThan(0)
  })
})

// ===========================================================================
// VALIDATION
// ===========================================================================
describe('Validation', () => {
  beforeEach(setupDemo)

  it('rejects market creation with too-few outcomes', async () => {
    const { agent } = await loginAs('admin')
    const res = await agent
      .post('/api/markets')
      .send({
        description: 'A short market description here.',
        endTime: Date.now() + 86_400_000,
        outcomes: ['Yes'],
      })
      .expect(400)
    expect(res.body.code).toBe('VALIDATION')
    expect(res.body.details.fieldErrors.outcomes).toBeTruthy()
  })

  it('rejects trade with non-positive chips', async () => {
    const { agent } = await loginAs('admin')
    const id = await createBinaryMarket(agent)
    const { agent: alice } = await loginAs('Alice')
    const res = await alice
      .post(`/api/markets/${id}/trade`)
      .send({ outcome: 0, chips: 0 })
      .expect(400)
    expect(res.body.code).toBe('VALIDATION')
  })

  it('rejects bad handle format', async () => {
    const res = await request(app).get('/api/users/has spaces/scoring').expect(400)
    expect(res.body.code).toBe('VALIDATION')
  })
})

// ===========================================================================
// MARKET LIFECYCLE
// ===========================================================================
describe('Trade lifecycle', () => {
  beforeEach(setupDemo)

  it('full flow: trade → propose → finalize → claim → grade', async () => {
    const { agent: admin } = await loginAs('admin')
    const id = await createBinaryMarket(admin)
    const { agent: alice } = await loginAs('Alice')
    const { agent: bob } = await loginAs('Bob')

    await alice.post(`/api/markets/${id}/trade`).send({ outcome: 0, chips: 200 }).expect(200)
    await bob.post(`/api/markets/${id}/trade`).send({ outcome: 1, chips: 300 }).expect(200)

    await admin.post(`/api/markets/${id}/propose`).send({ outcome: 0 }).expect(200)
    const fin = await admin.post(`/api/markets/${id}/finalize`).send({ outcome: 0 }).expect(200)
    expect(fin.body.resolvedOutcomeIndex).toBe(0)

    const claim = await alice.post(`/api/markets/${id}/claim`).send({}).expect(200)
    expect(claim.body.payout).toBeGreaterThan(0)

    const bobClaim = await bob.post(`/api/markets/${id}/claim`).send({}).expect(200)
    expect(bobClaim.body.payout || 0).toBe(0)

    const score = await request(app).get('/api/users/Alice/scoring').expect(200)
    expect(score.body.gradedTrades).toBe(1)
    expect(score.body.accuracy).toBe(1)
    expect(score.body.streak).toBe(1)

    const bobScore = await request(app).get('/api/users/Bob/scoring').expect(200)
    expect(bobScore.body.gradedTrades).toBe(1)
    expect(bobScore.body.accuracy).toBe(0)
  })

  it('rejects trades on a closed market', async () => {
    const { agent: admin } = await loginAs('admin')
    const id = await createBinaryMarket(admin)
    await admin.post(`/api/markets/${id}/propose`).send({ outcome: 0 }).expect(200)
    await admin.post(`/api/markets/${id}/finalize`).send({ outcome: 0 }).expect(200)

    const { agent: alice } = await loginAs('Alice')
    const res = await alice
      .post(`/api/markets/${id}/trade`)
      .send({ outcome: 0, chips: 50 })
      .expect(409)
    expect(res.body.code).toBe('CONFLICT')
  })

  it('returns INSUFFICIENT_BALANCE when user is broke', async () => {
    const { agent: admin } = await loginAs('admin')
    const id = await createBinaryMarket(admin)

    const agent = request.agent(app)
    await agent.post('/api/auth/register').send({ handle: 'Broke', password: 'aaaaaaaa' }).expect(201)
    await svc.prisma.user.update({ where: { handle: 'Broke' }, data: { chipsBalance: 0 } })

    const res = await agent
      .post(`/api/markets/${id}/trade`)
      .send({ outcome: 0, chips: 100 })
      .expect(409)
    expect(res.body.code).toBe('INSUFFICIENT_BALANCE')
  })
})

// ===========================================================================
// LEDGER + GRADING + BADGES
// ===========================================================================
describe('Ledger invariants', () => {
  beforeEach(setupDemo)

  it('Σ ledger amounts == User.chipsBalance after trades', async () => {
    const { agent: admin } = await loginAs('admin')
    const id = await createBinaryMarket(admin)
    const { agent: alice } = await loginAs('Alice')

    await alice.post(`/api/markets/${id}/trade`).send({ outcome: 0, chips: 100 }).expect(200)
    await alice.post(`/api/markets/${id}/trade`).send({ outcome: 1, chips: 50 }).expect(200)

    const inv = await ledgerInvariant('Alice')
    expect(inv.balance).toBeCloseTo(inv.ledgerSum, 6)
  })

  it('invariant survives propose → finalize → claim', async () => {
    const { agent: admin } = await loginAs('admin')
    const id = await createBinaryMarket(admin)
    const { agent: alice } = await loginAs('Alice')
    await alice.post(`/api/markets/${id}/trade`).send({ outcome: 0, chips: 200 }).expect(200)
    await admin.post(`/api/markets/${id}/propose`).send({ outcome: 0 }).expect(200)
    await admin.post(`/api/markets/${id}/finalize`).send({ outcome: 0 }).expect(200)
    await alice.post(`/api/markets/${id}/claim`).send({}).expect(200)

    const inv = await ledgerInvariant('Alice')
    expect(inv.balance).toBeCloseTo(inv.ledgerSum, 6)
  })
})

describe('Grading is idempotent', () => {
  beforeEach(setupDemo)

  it('re-running gradeAllTrades does not double-count', async () => {
    const { agent: admin } = await loginAs('admin')
    const id = await createBinaryMarket(admin)
    const { agent: alice } = await loginAs('Alice')
    await alice.post(`/api/markets/${id}/trade`).send({ outcome: 0, chips: 200 }).expect(200)
    await admin.post(`/api/markets/${id}/propose`).send({ outcome: 0 }).expect(200)
    await admin.post(`/api/markets/${id}/finalize`).send({ outcome: 0 }).expect(200)

    const before = await request(app).get('/api/users/Alice/scoring').expect(200)
    await svc.gradeAllTrades(id, 0, 2)
    const after = await request(app).get('/api/users/Alice/scoring').expect(200)

    expect(after.body.gradedTrades).toBe(before.body.gradedTrades)
    expect(after.body.pasRating).toBeCloseTo(before.body.pasRating, 6)
    expect(after.body.correctTrades).toBe(before.body.correctTrades)
  })
})

describe('Badge awarder', () => {
  beforeEach(setupDemo)

  it('awards `first_correct` after a winning trade resolves', async () => {
    const { agent: admin } = await loginAs('admin')
    const id = await createBinaryMarket(admin)
    const { agent: alice } = await loginAs('Alice')
    await alice.post(`/api/markets/${id}/trade`).send({ outcome: 0, chips: 100 }).expect(200)
    await admin.post(`/api/markets/${id}/propose`).send({ outcome: 0 }).expect(200)
    await admin.post(`/api/markets/${id}/finalize`).send({ outcome: 0 }).expect(200)

    const res = await request(app).get('/api/users/Alice/badges').expect(200)
    const slugs = res.body.earned.map(b => b.slug)
    expect(slugs).toContain('first_correct')
  })
})

// ===========================================================================
// LEADERBOARD
// ===========================================================================
describe('Leaderboard', () => {
  beforeEach(setupDemo)

  it('sorts by balance by default', async () => {
    await svc.prisma.user.update({ where: { handle: 'Alice' }, data: { chipsBalance: 9999 } })
    const res = await request(app).get('/api/leaderboard?by=balance&limit=5').expect(200)
    expect(res.body[0].user).toBe('Alice')
  })

  it('rejects unknown sort key', async () => {
    const res = await request(app).get('/api/leaderboard?by=unknown').expect(400)
    expect(res.body.code).toBe('VALIDATION')
  })
})

// ===========================================================================
// Discovery — listMarkets sort=trending|ending
// ===========================================================================
describe('Market discovery sorts', () => {
  beforeEach(setupDemo)

  async function createMarketWithEnd(agent, { description, endIn }) {
    const res = await agent
      .post('/api/markets')
      .send({
        description,
        endTime: Date.now() + endIn,
        outcomes: ['Yes', 'No'],
        category: 'Other',
      })
      .expect(201)
    return res.body.id ?? res.body.marketId
  }

  it('sort=ending returns LIVE markets ordered by endTime ascending', async () => {
    const { agent: adminAgent } = await loginAs('admin')
    const day = 86_400_000
    const farId = await createMarketWithEnd(adminAgent, { description: 'Far-future market for ending sort test.', endIn: 30 * day })
    const nearId = await createMarketWithEnd(adminAgent, { description: 'Near-future market for ending sort test.', endIn: 2 * day })
    const midId = await createMarketWithEnd(adminAgent, { description: 'Mid-future market for ending sort test.', endIn: 7 * day })

    const res = await request(app).get('/api/markets?sort=ending&limit=10').expect(200)
    const ids = res.body.map(m => m.id)
    const idxNear = ids.indexOf(nearId)
    const idxMid = ids.indexOf(midId)
    const idxFar = ids.indexOf(farId)
    expect(idxNear).toBeGreaterThanOrEqual(0)
    expect(idxNear).toBeLessThan(idxMid)
    expect(idxMid).toBeLessThan(idxFar)
  })

  it('sort=trending ranks markets by trade count in the last 24h', async () => {
    const { agent: adminAgent } = await loginAs('admin')
    const hotId = await createMarketWithEnd(adminAgent, { description: 'Hot market accumulating trades.', endIn: 7 * 86_400_000 })
    const coldId = await createMarketWithEnd(adminAgent, { description: 'Cold market with one trade.', endIn: 7 * 86_400_000 })

    const { agent: aliceAgent } = await loginAs('Alice')
    const { agent: bobAgent } = await loginAs('Bob')
    // 3 trades on hot, 1 on cold
    await aliceAgent.post(`/api/markets/${hotId}/trade`).send({ outcome: 0, chips: 50 }).expect(200)
    await bobAgent.post(`/api/markets/${hotId}/trade`).send({ outcome: 1, chips: 50 }).expect(200)
    await aliceAgent.post(`/api/markets/${hotId}/trade`).send({ outcome: 0, chips: 50 }).expect(200)
    await bobAgent.post(`/api/markets/${coldId}/trade`).send({ outcome: 0, chips: 50 }).expect(200)

    const res = await request(app).get('/api/markets?sort=trending&limit=20').expect(200)
    const ids = res.body.map(m => m.id)
    expect(ids.indexOf(hotId)).toBeLessThan(ids.indexOf(coldId))
  })

  it('sort=trending excludes RESOLVED markets', async () => {
    const { agent: adminAgent } = await loginAs('admin')
    const id = await createBinaryMarket(adminAgent)
    await adminAgent.post(`/api/markets/${id}/propose`).send({ outcome: 0 }).expect(200)
    await adminAgent.post(`/api/markets/${id}/finalize`).send({ outcome: 0 }).expect(200)

    const res = await request(app).get('/api/markets?sort=trending').expect(200)
    expect(res.body.find(m => m.id === id)).toBeUndefined()
  })

  it('rejects unknown sort value', async () => {
    const res = await request(app).get('/api/markets?sort=garbage').expect(400)
    expect(res.body.code).toBe('VALIDATION')
  })
})

// ===========================================================================
// Lifecycle actions — /api/me/actions + /api/me/claim-all
// ===========================================================================
describe('Lifecycle actions', () => {
  beforeEach(setupDemo)

  async function resolveMarket(adminAgent, marketId, outcomeIdx) {
    await adminAgent.post(`/api/markets/${marketId}/propose`).send({ outcome: outcomeIdx }).expect(200)
    await adminAgent.post(`/api/markets/${marketId}/finalize`).send({ outcome: outcomeIdx }).expect(200)
  }

  it('reports zero actions for a fresh user', async () => {
    const { agent } = await loginAs('Alice')
    const res = await agent.get('/api/me/actions').expect(200)
    expect(res.body.total).toBe(0)
    expect(res.body.claimable.count).toBe(0)
    expect(res.body.needsProposal.count).toBe(0)
    expect(res.body.openDisputes.count).toBe(0)
  })

  it('surfaces a claimable position after market resolves', async () => {
    const { agent: adminAgent } = await loginAs('admin')
    const id = await createBinaryMarket(adminAgent)
    const { agent: aliceAgent } = await loginAs('Alice')
    await aliceAgent.post(`/api/markets/${id}/trade`).send({ outcome: 0, chips: 200 }).expect(200)
    await resolveMarket(adminAgent, id, 0)

    const res = await aliceAgent.get('/api/me/actions').expect(200)
    expect(res.body.claimable.count).toBe(1)
    expect(res.body.claimable.totalChips).toBeGreaterThan(0)
    expect(res.body.total).toBe(1)
  })

  it('surfaces needs-proposal for owners whose markets ended', async () => {
    const { agent: adminAgent } = await loginAs('admin')
    // Create with a very-near future endTime then advance the row past it.
    const id = await createBinaryMarket(adminAgent, { endIn: 60_000 })
    await svc.prisma.market.update({
      where: { id },
      data: { endTime: new Date(Date.now() - 5_000) },
    })

    const res = await adminAgent.get('/api/me/actions').expect(200)
    expect(res.body.needsProposal.count).toBe(1)
    expect(res.body.needsProposal.items[0].marketId).toBe(id)
  })

  it('surfaces open dispute windows for users with stakes', async () => {
    const { agent: adminAgent } = await loginAs('admin')
    const id = await createBinaryMarket(adminAgent)
    const { agent: aliceAgent } = await loginAs('Alice')
    await aliceAgent.post(`/api/markets/${id}/trade`).send({ outcome: 0, chips: 100 }).expect(200)
    await adminAgent.post(`/api/markets/${id}/propose`).send({ outcome: 0 }).expect(200)

    const res = await aliceAgent.get('/api/me/actions').expect(200)
    expect(res.body.openDisputes.count).toBe(1)
    expect(res.body.openDisputes.items[0].marketId).toBe(id)
    expect(res.body.openDisputes.items[0].proposedOutcome).toBe('Yes')
  })

  it('claim-all claims every winning position and totals the payout', async () => {
    const { agent: adminAgent } = await loginAs('admin')
    const id1 = await createBinaryMarket(adminAgent, { description: 'Claim-all test #1.' })
    const id2 = await createBinaryMarket(adminAgent, { description: 'Claim-all test #2.' })

    const { agent: aliceAgent } = await loginAs('Alice')
    await aliceAgent.post(`/api/markets/${id1}/trade`).send({ outcome: 0, chips: 300 }).expect(200)
    await aliceAgent.post(`/api/markets/${id2}/trade`).send({ outcome: 0, chips: 200 }).expect(200)
    await resolveMarket(adminAgent, id1, 0)
    await resolveMarket(adminAgent, id2, 0)

    const before = await aliceAgent.get('/api/me/balance').expect(200)

    const res = await aliceAgent.post('/api/me/claim-all').expect(200)
    expect(res.body.claimedMarkets).toBe(2)
    expect(res.body.totalPayout).toBeGreaterThan(0)
    expect(res.body.balance).toBeGreaterThan(before.body.balance)

    // Second call should be a no-op (idempotent).
    const second = await aliceAgent.post('/api/me/claim-all').expect(200)
    expect(second.body.claimedMarkets).toBe(0)
    expect(second.body.totalPayout).toBe(0)
  })

  it('claim-all requires auth', async () => {
    await request(app).post('/api/me/claim-all').expect(401)
  })
})

// ===========================================================================
// New-user onboarding (firstTradeAt)
// ===========================================================================
describe('First-trade onboarding', () => {
  beforeEach(setupDemo)

  it('fresh user has firstTradeAt=null on /api/auth/me', async () => {
    const { agent: adminAgent } = await loginAs('admin')
    await createBinaryMarket(adminAgent)  // so Alice has a market to trade on

    const { agent: aliceAgent } = await loginAs('Alice')
    const me = await aliceAgent.get('/api/auth/me').expect(200)
    expect(me.body.user.firstTradeAt).toBeNull()
  })

  it('first BUY stamps firstTradeAt and second BUY does not overwrite it', async () => {
    const { agent: adminAgent } = await loginAs('admin')
    const id = await createBinaryMarket(adminAgent)

    const { agent: aliceAgent } = await loginAs('Alice')
    await aliceAgent
      .post(`/api/markets/${id}/trade`)
      .send({ outcome: 0, chips: 100 })
      .expect(200)

    const after1 = await aliceAgent.get('/api/auth/me').expect(200)
    const stampedAt = after1.body.user.firstTradeAt
    expect(stampedAt).toBeTruthy()

    // Small delay so a clobbered timestamp would be detectably different.
    await new Promise(r => setTimeout(r, 25))
    await aliceAgent
      .post(`/api/markets/${id}/trade`)
      .send({ outcome: 0, chips: 50 })
      .expect(200)

    const after2 = await aliceAgent.get('/api/auth/me').expect(200)
    expect(after2.body.user.firstTradeAt).toBe(stampedAt)
  })
})

// ===========================================================================
// Health & 404
// ===========================================================================
describe('Health & 404', () => {
  it('GET /health returns ok with uptime + dbMs', async () => {
    const res = await request(app).get('/health').expect(200)
    expect(res.body.ok).toBe(true)
    expect(typeof res.body.uptimeMs).toBe('number')
    expect(typeof res.body.dbMs).toBe('number')
    expect(res.body.env).toBe('test')
  })

  it('unknown /api/* path returns structured 404', async () => {
    const res = await request(app).get('/api/does-not-exist').expect(404)
    expect(res.body).toEqual({ error: 'Not found', code: 'NOT_FOUND' })
  })

  it('every response carries an X-Request-Id header', async () => {
    const res = await request(app).get('/health').expect(200)
    expect(res.headers['x-request-id']).toMatch(/^[a-f0-9]{16}$/)
  })

  it('honors an upstream X-Request-Id header', async () => {
    const res = await request(app)
      .get('/health')
      .set('X-Request-Id', 'upstream-abc-123')
      .expect(200)
    expect(res.headers['x-request-id']).toBe('upstream-abc-123')
  })
})

// ===========================================================================
// Config / env validation
// ===========================================================================
describe('Config — loadConfig()', () => {
  const { loadConfig, ConfigError } = require('../server/config')

  function withEnv(overrides, fn) {
    const saved = { ...process.env }
    Object.assign(process.env, overrides)
    // Remove keys explicitly set to undefined.
    for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete process.env[k]
    try { return fn() }
    finally { process.env = saved }
  }

  it('returns a typed config in dev with sensible defaults', () => {
    const cfg = withEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'file:./dev.db',
      DEMO_PASSWORD: undefined,
      MISTRAL_API_KEY: undefined,
      GOOGLE_CLIENT_ID: undefined,
      NEWS_INGEST_INTERVAL_MIN: undefined,
    }, () => loadConfig())
    expect(cfg.NODE_ENV).toBe('development')
    expect(cfg.PORT).toBe(3000)
    expect(cfg.DEMO_PASSWORD).toBe('demo1234')
    expect(cfg.isProduction).toBe(false)
    expect(cfg.hasMistral).toBe(false)
  })

  it('rejects production boot when DEMO_PASSWORD is still default', () => {
    expect(() => withEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://x',
      DEMO_PASSWORD: 'demo1234',
    }, () => loadConfig())).toThrow(ConfigError)
  })

  it('rejects production boot when DATABASE_URL is missing', () => {
    expect(() => withEnv({
      NODE_ENV: 'production',
      DATABASE_URL: undefined,
      DEMO_PASSWORD: 'a-strong-password',
    }, () => loadConfig())).toThrow(/DATABASE_URL/)
  })

  it('rejects out-of-range NEWS_DRAFT_MIN_CONFIDENCE', () => {
    expect(() => withEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'file:./dev.db',
      NEWS_DRAFT_MIN_CONFIDENCE: '1.5',
    }, () => loadConfig())).toThrow(/NEWS_DRAFT_MIN_CONFIDENCE/)
  })

  it('flags news scheduler as enabled when interval is set', () => {
    const cfg = withEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'file:./dev.db',
      NEWS_INGEST_INTERVAL_MIN: '60',
    }, () => loadConfig())
    expect(cfg.newsSchedulerEnabled).toBe(true)
    expect(cfg.NEWS_INGEST_INTERVAL_MIN).toBe(60)
  })
})
