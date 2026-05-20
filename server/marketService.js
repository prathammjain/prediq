// MarketService — Prisma-backed replacement for the in-memory MarketEngine.
// Implements LMSR pricing, a dispute-window resolution flow, and a full
// chip-transaction ledger + skill-scoring (PAS) pipeline.
const { PrismaClient } = require('@prisma/client')
const { forMarket } = require('./marketMath')
const bus = require('./marketBus')
const { seedSharesForBudget } = require('./lslmsr')
const { gradeTrade } = require('./scoring')
const { calibrationReport } = require('./calibration')
const { recommendedB } = require('./adaptiveLiquidity')
const { evaluateBadges } = require('./badges')
const {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  InsufficientBalanceError,
} = require('./errors')

const prisma = new PrismaClient()

const DISPUTE_WINDOW_MS = 24 * 60 * 60 * 1000
const DAILY_BONUS_AMOUNT = 500
const DAILY_BONUS_COOLDOWN_MS = 24 * 60 * 60 * 1000
const SEED_STARTING_CHIPS = 5000

// --- Ledger -----------------------------------------------------------------
// Every chip movement is mirrored into CoinTransaction. `balanceAfter` is
// captured at write time so the table is self-describing for analytics.
function ledgerEntry({ userId, type, amount, balanceAfter, marketId = null, tradeId = null, note = null }) {
  return prisma.coinTransaction.create({
    data: { userId, type, amount, balanceAfter, marketId, tradeId, note },
  })
}

async function ensureUser(handle) {
  const existing = await prisma.user.findUnique({ where: { handle } })
  if (existing) return existing
  const created = await prisma.user.create({
    data: { handle, chipsBalance: SEED_STARTING_CHIPS },
  })
  await ledgerEntry({
    userId: created.id,
    type: 'SIGNUP_BONUS',
    amount: SEED_STARTING_CHIPS,
    balanceAfter: SEED_STARTING_CHIPS,
    note: 'Welcome to predIQ',
  })
  return created
}

async function getBalance(handle) {
  const u = await ensureUser(handle)
  return u.chipsBalance
}

async function getMarketState(marketId) {
  const market = await prisma.market.findUnique({
    where: { id: marketId },
    include: { outcomes: { orderBy: { index: 'asc' } }, owner: true },
  })
  if (!market) return null
  const q = market.outcomes.map(o => o.sharesOutstanding)
  const math = forMarket(market)
  return { market, q, pricesVec: math.prices(q), math }
}

function serializeMarket(state) {
  const { market, q, pricesVec } = state
  return {
    id: market.id,
    description: market.description,
    category: market.category,
    imageUrl: market.imageUrl,
    resolutionSource: market.resolutionSource,
    createdAt: market.createdAt.getTime(),
    endTime: market.endTime.getTime(),
    owner: market.owner.handle,
    liquidityB: market.liquidityB,
    useLsLmsr: market.useLsLmsr,
    lsAlpha: market.lsAlpha,
    status: market.status,
    proposedOutcomeIndex: market.proposedOutcomeIndex,
    proposedAt: market.proposedAt?.getTime() ?? null,
    disputeUntil: market.disputeUntil?.getTime() ?? null,
    resolvedOutcomeIndex: market.resolvedOutcomeIndex,
    resolvedAt: market.resolvedAt?.getTime() ?? null,
    outcomes: market.outcomes.map(o => o.name),
    sharesOutstanding: q,
    percents: pricesVec,
    // LMSR "volume" proxy: sum of shares across outcomes (rough activity indicator).
    volume: q.reduce((a, b) => a + b, 0),
  }
}

// Window used by `sort=trending` to count "what's hot right now". 24h is
// short enough to surface live activity, long enough to survive overnight.
const TRENDING_WINDOW_MS = 24 * 60 * 60 * 1000

async function listMarkets(filter = {}) {
  const { category, sort = 'new', limit } = filter
  const where = {}
  if (category && category !== 'All') where.category = category

  // 'trending' and 'ending' both restrict to LIVE markets so users don't get
  // pushed toward a closed market that they can't act on.
  if (sort === 'trending' || sort === 'ending') {
    where.status = 'LIVE'
    where.endTime = { gt: new Date() }
  }

  if (sort === 'trending') {
    // Pull recent trade counts per market in a single groupBy, then sort the
    // candidate market list by that count. Markets with zero recent trades
    // fall to the bottom (tie-broken by createdAt desc).
    const since = new Date(Date.now() - TRENDING_WINDOW_MS)
    const candidates = await prisma.market.findMany({
      where,
      include: { outcomes: { orderBy: { index: 'asc' } }, owner: true },
    })
    if (candidates.length === 0) return []
    const counts = await prisma.trade.groupBy({
      by: ['marketId'],
      where: { marketId: { in: candidates.map(m => m.id) }, createdAt: { gt: since } },
      _count: { _all: true },
    })
    const countByMarket = new Map(counts.map(c => [c.marketId, c._count._all]))
    const ranked = candidates
      .map(m => ({ m, c: countByMarket.get(m.id) ?? 0 }))
      .sort((a, b) => (b.c - a.c) || (b.m.createdAt - a.m.createdAt))
      .map(x => x.m)
    const sliced = typeof limit === 'number' ? ranked.slice(0, limit) : ranked
    return sliced.map(m => {
      const q = m.outcomes.map(o => o.sharesOutstanding)
      return serializeMarket({ market: m, q, pricesVec: forMarket(m).prices(q) })
    })
  }

  const orderBy = sort === 'ending'
    ? { endTime: 'asc' }
    : { createdAt: 'desc' }

  const rows = await prisma.market.findMany({
    where,
    include: { outcomes: { orderBy: { index: 'asc' } }, owner: true },
    orderBy,
    ...(typeof limit === 'number' ? { take: limit } : {}),
  })
  return rows.map(m => {
    const q = m.outcomes.map(o => o.sharesOutstanding)
    return serializeMarket({ market: m, q, pricesVec: forMarket(m).prices(q) })
  })
}

async function getMarket(id) {
  const state = await getMarketState(id)
  if (!state) return null
  const snapshots = await prisma.priceSnapshot.findMany({
    where: { marketId: id },
    orderBy: { t: 'asc' },
    take: 200,
  })
  const history = snapshots.map(s => ({
    t: s.t.getTime(),
    percents: JSON.parse(s.percents),
  }))
  // Always include the initial snapshot (market creation)
  if (history.length === 0) {
    history.push({ t: state.market.createdAt.getTime(), percents: state.pricesVec })
  }
  return { ...serializeMarket(state), history }
}

async function createMarket(input) {
  const {
    description,
    endTime,
    ownerHandle,
    outcomes,
    category = 'Other',
    resolutionSource = '',
    imageUrl = null,
    liquidityB = 500,
    useLsLmsr = false,
    lsAlpha = 0.05,
  } = input
  if (!description || !endTime || !ownerHandle) throw new ValidationError('Missing required fields')
  if (!outcomes || outcomes.length < 2) throw new ValidationError('Need at least 2 outcomes')
  if (useLsLmsr && !(lsAlpha > 0)) throw new ValidationError('lsAlpha must be positive')

  // For LS-LMSR markets, seed each outcome with a positive share inventory
  // so that b(q) = α·Σq equals the requested initial liquidityB. This keeps
  // initial fair probabilities at 1/N and avoids the Σq = 0 singularity.
  const seedPerOutcome = useLsLmsr
    ? seedSharesForBudget(liquidityB, lsAlpha, outcomes.length)
    : 0

  const owner = await ensureUser(ownerHandle)
  const market = await prisma.market.create({
    data: {
      description,
      category,
      resolutionSource,
      imageUrl,
      endTime: new Date(endTime),
      ownerId: owner.id,
      liquidityB,
      useLsLmsr,
      lsAlpha,
      status: 'LIVE',
      outcomes: {
        create: outcomes.map((name, i) => ({
          index: i, name, sharesOutstanding: seedPerOutcome,
        })),
      },
    },
    include: { outcomes: true },
  })
  // Seed initial price snapshot using the same math the market will use.
  const q0 = new Array(outcomes.length).fill(seedPerOutcome)
  const initialPrices = forMarket(market).prices(q0)
  await prisma.priceSnapshot.create({
    data: { marketId: market.id, percents: JSON.stringify(initialPrices) },
  })
  return market.id
}

// BUY: user spends `chips` to buy shares of outcome `outcomeIndex`.
// Returns { shares, avgFillPrice, balance, percents }.
async function tradeBuy({ userHandle, marketId, outcomeIndex, chips }) {
  if (!(chips > 0)) throw new ValidationError('Invalid amount')
  const user = await ensureUser(userHandle)
  if (user.chipsBalance < chips) throw new InsufficientBalanceError()

  const state = await getMarketState(marketId)
  if (!state) throw new NotFoundError('Market not found')
  const { market, q, math } = state

  if (market.status !== 'LIVE') throw new ConflictError(`Market is ${market.status.toLowerCase()}`)
  if (Date.now() >= market.endTime.getTime()) throw new ConflictError('Market closed')
  if (outcomeIndex < 0 || outcomeIndex >= market.outcomes.length) throw new ValidationError('Invalid outcome')

  const sharesBought = math.sharesForChips(q, outcomeIndex, chips)
  const chipsCharged = math.costOfBuying(q, outcomeIndex, sharesBought) // should ~= chips
  const avgFillPrice = chipsCharged / sharesBought
  const newQ = q.slice()
  newQ[outcomeIndex] += sharesBought
  const newPrices = math.prices(newQ)

  const outcomeRow = market.outcomes[outcomeIndex]

  // Persist the trade + balance + position + price snapshot atomically,
  // then mirror the chip movement into CoinTransaction and update lifetime
  // stake counters. The grading fields on Trade stay null until the parent
  // market resolves.
  const result = await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: user.id },
      data: {
        chipsBalance: { decrement: chipsCharged },
        totalStaked: { increment: chipsCharged },
        // Stamp first-trade timestamp once and never overwrite. The
        // welcome card on Home keys off this — null means new user.
        ...(user.firstTradeAt ? {} : { firstTradeAt: new Date() }),
      },
    })
    await tx.outcome.update({
      where: { id: outcomeRow.id },
      data: { sharesOutstanding: { increment: sharesBought } },
    })
    await tx.sharePosition.upsert({
      where: {
        userId_marketId_outcomeIndex: { userId: user.id, marketId, outcomeIndex },
      },
      create: {
        userId: user.id, marketId, outcomeIndex,
        shares: sharesBought, chipsSpent: chipsCharged,
      },
      update: {
        shares: { increment: sharesBought },
        chipsSpent: { increment: chipsCharged },
      },
    })
    const trade = await tx.trade.create({
      data: {
        userId: user.id, marketId, outcomeIndex,
        side: 'BUY', shares: sharesBought, chipsDelta: chipsCharged, avgFillPrice,
      },
    })
    await tx.coinTransaction.create({
      data: {
        userId: user.id,
        type: 'TRADE_BUY',
        amount: -chipsCharged,
        balanceAfter: updatedUser.chipsBalance,
        marketId,
        tradeId: trade.id,
        note: `Bought ${sharesBought.toFixed(4)} shares of outcome #${outcomeIndex}`,
      },
    })
    await tx.priceSnapshot.create({
      data: { marketId, percents: JSON.stringify(newPrices) },
    })
    return updatedUser
  })

  // Push a real-time snapshot to subscribers (SSE). Best-effort — subscribe
  // failures must not affect the trade.
  try {
    bus.publish(marketId, {
      kind: 'price',
      percents: newPrices,
      sharesOutstanding: newQ,
      volume: newQ.reduce((a, b) => a + b, 0),
      t: Date.now(),
    })
  } catch (e) { console.error('bus.publish failed', e) }

  // NOTE on liquidity: classic-LMSR markets keep `liquidityB` fixed (mutating
  // it mid-market would create a price discontinuity for held positions). For
  // markets created with `useLsLmsr = true` the effective b ≡ α·Σq is recomputed
  // from share state on every read, so liquidity grows naturally with volume —
  // no schema mutation required (see server/marketMath.js).

  // Volume threshold badges (e.g. "Whale") may now be eligible.
  try { await evaluateBadges(prisma, user.id) } catch (e) {
    console.error('badge evaluation failed', e)
  }

  return {
    shares: sharesBought,
    avgFillPrice,
    chipsCharged,
    balance: result.chipsBalance,
    percents: newPrices,
  }
}

// Preview: what would happen if user bought `chips` of `outcomeIndex` right now?
async function previewTrade({ marketId, outcomeIndex, chips }) {
  const state = await getMarketState(marketId)
  if (!state) throw new NotFoundError('Market not found')
  const { q, math } = state
  const shares = math.sharesForChips(q, outcomeIndex, chips)
  const cost = math.costOfBuying(q, outcomeIndex, shares)
  const newQ = q.slice(); newQ[outcomeIndex] += shares
  return {
    shares,
    cost,
    avgFillPrice: shares > 0 ? cost / shares : 0,
    newPercents: math.prices(newQ),
    potentialPayoutIfWin: shares, // 1 chip per winning share
  }
}

// SELL: user redeems `shares` of outcome `outcomeIndex` for chips at the
// current LMSR refund price. Position must cover the requested shares.
//
// IMPORTANT — PAS implication: the original BUY trade still grades when the
// market resolves, even if the user has fully exited. This means hedge-and-
// flip cycles can rack up PAS without resolution risk. Acceptable for now
// (the headline feature is just letting users exit); a future enhancement
// would weight grading by held-shares-at-resolution.
async function tradeSell({ userHandle, marketId, outcomeIndex, shares }) {
  if (!(shares > 0)) throw new ValidationError('Invalid amount')
  const user = await ensureUser(userHandle)

  const state = await getMarketState(marketId)
  if (!state) throw new NotFoundError('Market not found')
  const { market, q, math } = state

  if (market.status !== 'LIVE') throw new ConflictError(`Market is ${market.status.toLowerCase()}`)
  if (Date.now() >= market.endTime.getTime()) throw new ConflictError('Market closed')
  if (outcomeIndex < 0 || outcomeIndex >= market.outcomes.length) throw new ValidationError('Invalid outcome')

  const position = await prisma.sharePosition.findUnique({
    where: { userId_marketId_outcomeIndex: { userId: user.id, marketId, outcomeIndex } },
  })
  if (!position || position.shares < shares) {
    throw new ValidationError(`You only hold ${position?.shares?.toFixed(4) ?? 0} shares`)
  }

  const refund = math.refundForSelling(q, outcomeIndex, shares)
  if (!Number.isFinite(refund) || refund <= 0) {
    throw new ConflictError('Refund computation failed (insufficient liquidity)')
  }
  const avgFillPrice = refund / shares
  const newQ = q.slice(); newQ[outcomeIndex] -= shares
  const newPrices = math.prices(newQ)
  const outcomeRow = market.outcomes[outcomeIndex]

  // Cost basis: scale chipsSpent down proportionally so avgCost stays stable
  // for any remaining shares.
  const fractionRemaining = (position.shares - shares) / position.shares
  const newChipsSpent = position.chipsSpent * fractionRemaining

  const result = await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: user.id },
      data: { chipsBalance: { increment: refund } },
    })
    await tx.outcome.update({
      where: { id: outcomeRow.id },
      data: { sharesOutstanding: { decrement: shares } },
    })
    await tx.sharePosition.update({
      where: {
        userId_marketId_outcomeIndex: { userId: user.id, marketId, outcomeIndex },
      },
      data: {
        shares: { decrement: shares },
        chipsSpent: newChipsSpent,
      },
    })
    const trade = await tx.trade.create({
      data: {
        userId: user.id, marketId, outcomeIndex,
        side: 'SELL', shares, chipsDelta: -refund,  // chipsDelta < 0 means chips returned to user
        avgFillPrice,
      },
    })
    await tx.coinTransaction.create({
      data: {
        userId: user.id,
        type: 'TRADE_SELL',
        amount: refund,
        balanceAfter: updatedUser.chipsBalance,
        marketId,
        tradeId: trade.id,
        note: `Sold ${shares.toFixed(4)} shares of outcome #${outcomeIndex}`,
      },
    })
    await tx.priceSnapshot.create({
      data: { marketId, percents: JSON.stringify(newPrices) },
    })
    return updatedUser
  })

  try {
    bus.publish(marketId, {
      kind: 'price',
      percents: newPrices,
      sharesOutstanding: newQ,
      volume: newQ.reduce((a, b) => a + b, 0),
      t: Date.now(),
    })
  } catch (e) { console.error('bus.publish failed', e) }

  return {
    shares,
    avgFillPrice,
    refund,
    balance: result.chipsBalance,
    percents: newPrices,
  }
}

// Preview: what would the user get if they sold `shares` right now?
async function previewSell({ marketId, outcomeIndex, shares }) {
  const state = await getMarketState(marketId)
  if (!state) throw new NotFoundError('Market not found')
  const { q, math } = state
  if (!(shares > 0)) return { refund: 0, avgFillPrice: 0, newPercents: math.prices(q) }
  const refund = math.refundForSelling(q, outcomeIndex, shares)
  if (!Number.isFinite(refund)) {
    return { refund: 0, avgFillPrice: 0, newPercents: math.prices(q), error: 'Insufficient liquidity' }
  }
  const newQ = q.slice(); newQ[outcomeIndex] -= shares
  return {
    refund,
    avgFillPrice: refund / shares,
    newPercents: math.prices(newQ),
  }
}

async function proposeResolution({ userHandle, marketId, outcomeIndex }) {
  const user = await ensureUser(userHandle)
  const market = await prisma.market.findUnique({
    where: { id: marketId }, include: { outcomes: true },
  })
  if (!market) throw new NotFoundError('Market not found')
  if (market.ownerId !== user.id && user.role !== 'ADMIN') {
    throw new ForbiddenError('Only the market creator can propose resolution')
  }
  if (market.status === 'RESOLVED') throw new ConflictError('Market already resolved')
  if (outcomeIndex < 0 || outcomeIndex >= market.outcomes.length) throw new ValidationError('Invalid outcome')

  const now = new Date()
  const updated = await prisma.market.update({
    where: { id: marketId },
    data: {
      status: 'PROPOSED',
      proposedOutcomeIndex: outcomeIndex,
      proposedAt: now,
      disputeUntil: new Date(now.getTime() + DISPUTE_WINDOW_MS),
    },
  })
  try {
    bus.publish(marketId, {
      kind: 'status',
      status: 'PROPOSED',
      proposedOutcomeIndex: outcomeIndex,
      disputeUntil: updated.disputeUntil.getTime(),
      t: Date.now(),
    })
  } catch (e) { console.error('bus.publish failed', e) }
  return updated
}

async function disputeResolution({ userHandle, marketId }) {
  await ensureUser(userHandle) // anyone can flag
  const market = await prisma.market.findUnique({ where: { id: marketId } })
  if (!market) throw new NotFoundError('Market not found')
  if (market.status !== 'PROPOSED') throw new ConflictError('Not in dispute window')
  if (Date.now() > market.disputeUntil.getTime()) throw new ConflictError('Dispute window closed')
  const updated = await prisma.market.update({
    where: { id: marketId },
    data: { status: 'DISPUTED' },
  })
  try {
    bus.publish(marketId, { kind: 'status', status: 'DISPUTED', t: Date.now() })
  } catch (e) { console.error('bus.publish failed', e) }
  return updated
}

// Finalize: lock in the proposed outcome after the dispute window, OR admin
// override. Once finalised we *grade* every trade on the market — computing
// per-trade Brier loss, log loss, PAS delta — and propagate the aggregates
// onto each user's profile. Streaks update in temporal order of trades so a
// user who placed three correct trades in a row sees streak=3.
async function finalizeResolution({ userHandle, marketId, adminOutcomeIndex }) {
  const user = await ensureUser(userHandle)
  const isAdmin = user.role === 'ADMIN'
  const market = await prisma.market.findUnique({ where: { id: marketId }, include: { outcomes: true } })
  if (!market) throw new NotFoundError('Market not found')
  if (market.status === 'RESOLVED') throw new ConflictError('Already resolved')

  let outcomeIndex
  if (market.status === 'PROPOSED' && Date.now() >= market.disputeUntil.getTime()) {
    outcomeIndex = market.proposedOutcomeIndex
  } else if (isAdmin && typeof adminOutcomeIndex === 'number') {
    outcomeIndex = adminOutcomeIndex
  } else {
    throw new ConflictError('Cannot finalize: dispute window still open or not in a finalizable state')
  }

  await prisma.market.update({
    where: { id: marketId },
    data: {
      status: 'RESOLVED',
      resolvedOutcomeIndex: outcomeIndex,
      resolvedAt: new Date(),
    },
  })

  await gradeAllTrades(marketId, outcomeIndex, market.outcomes.length)

  try {
    bus.publish(marketId, {
      kind: 'status',
      status: 'RESOLVED',
      resolvedOutcomeIndex: outcomeIndex,
      t: Date.now(),
    })
  } catch (e) { console.error('bus.publish failed', e) }

  return { marketId, resolvedOutcomeIndex: outcomeIndex }
}

// Grade every trade on a freshly resolved market. Idempotent: trades with
// graded=true are skipped, so re-running this is safe.
async function gradeAllTrades(marketId, winningIndex, numOutcomes) {
  const trades = await prisma.trade.findMany({
    where: { marketId, graded: false },
    orderBy: { createdAt: 'asc' },
  })

  // Group per user so we can update streak/longestStreak in chronological
  // order with one DB write per user instead of one per trade.
  const perUser = new Map()
  for (const t of trades) {
    if (!perUser.has(t.userId)) perUser.set(t.userId, [])
    perUser.get(t.userId).push(t)
  }

  for (const [userId, userTrades] of perUser) {
    const u = await prisma.user.findUnique({ where: { id: userId } })
    if (!u) continue

    let pas = u.pasRating
    let pasPeak = u.pasPeak
    let brierAdd = 0
    let logAdd = 0
    let correctAdd = 0
    let gradedAdd = 0
    let streak = u.streak
    let longest = u.longestStreak
    let xpAdd = 0
    const tradePatches = []

    for (const t of userTrades) {
      const won = t.outcomeIndex === winningIndex
      const grade = gradeTrade({
        avgFillPrice: t.avgFillPrice,
        chips: t.chipsDelta,
        won,
        numOutcomes,
      })
      pas += grade.pasDelta
      if (pas > pasPeak) pasPeak = pas
      brierAdd += grade.brierLoss
      logAdd += grade.logLoss
      gradedAdd += 1
      if (won) {
        correctAdd += 1
        streak += 1
        if (streak > longest) longest = streak
        // XP: small base + bonus for contrarian wins (low p ⇒ surprise).
        xpAdd += 10 + Math.round(20 * (1 - Math.min(1, Math.max(0, t.avgFillPrice))))
      } else {
        streak = 0
      }
      tradePatches.push({
        id: t.id,
        graded: true,
        isCorrect: won,
        brierLoss: grade.brierLoss,
        logLoss: grade.logLoss,
        pasDelta: grade.pasDelta,
        numOutcomes,
      })
    }

    await prisma.$transaction([
      ...tradePatches.map(p => prisma.trade.update({
        where: { id: p.id },
        data: {
          graded: true,
          isCorrect: p.isCorrect,
          brierLoss: p.brierLoss,
          logLoss: p.logLoss,
          pasDelta: p.pasDelta,
          numOutcomes: p.numOutcomes,
        },
      })),
      prisma.user.update({
        where: { id: userId },
        data: {
          pasRating: pas,
          pasPeak,
          brierSum: { increment: brierAdd },
          logScoreSum: { increment: logAdd },
          gradedTrades: { increment: gradedAdd },
          correctTrades: { increment: correctAdd },
          streak,
          longestStreak: longest,
          xp: { increment: xpAdd },
        },
      }),
    ])

    // Evaluate any newly-earned badges. Idempotent — already-owned badges
    // are skipped. Errors here should not abort grading, so we log & continue.
    try {
      await evaluateBadges(prisma, userId)
    } catch (e) {
      console.error('badge evaluation failed for', userId, e)
    }
  }
}

async function claimPayout({ userHandle, marketId }) {
  const user = await ensureUser(userHandle)
  const market = await prisma.market.findUnique({ where: { id: marketId } })
  if (!market) throw new NotFoundError('Market not found')
  if (market.status !== 'RESOLVED') throw new ConflictError('Market not resolved yet')

  const pos = await prisma.sharePosition.findUnique({
    where: { userId_marketId_outcomeIndex: { userId: user.id, marketId, outcomeIndex: market.resolvedOutcomeIndex } },
  })
  if (!pos || pos.shares === 0 || pos.claimed) return { payout: 0, balance: user.chipsBalance }

  // 1 chip per winning share (LMSR payoff).
  const payout = pos.shares
  const pnl = payout - pos.chipsSpent

  const result = await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: user.id },
      data: {
        chipsBalance: { increment: payout },
        totalPnL: { increment: pnl },
      },
    })
    await tx.sharePosition.update({
      where: { id: pos.id },
      data: { claimed: true },
    })
    await tx.coinTransaction.create({
      data: {
        userId: user.id,
        type: 'TRADE_PAYOUT',
        amount: payout,
        balanceAfter: updatedUser.chipsBalance,
        marketId,
        note: `Payout for ${pos.shares.toFixed(4)} winning shares`,
      },
    })
    return updatedUser
  })

  return { payout, pnl, balance: result.chipsBalance }
}

async function claimDailyBonus(userHandle) {
  const user = await ensureUser(userHandle)
  const now = new Date()
  const last = user.lastBonusAt
  if (last && now.getTime() - last.getTime() < DAILY_BONUS_COOLDOWN_MS) {
    return {
      credited: 0,
      balance: user.chipsBalance,
      nextEligibleAt: last.getTime() + DAILY_BONUS_COOLDOWN_MS,
    }
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      chipsBalance: { increment: DAILY_BONUS_AMOUNT },
      lastBonusAt: now,
    },
  })
  await ledgerEntry({
    userId: user.id,
    type: 'DAILY_BONUS',
    amount: DAILY_BONUS_AMOUNT,
    balanceAfter: updated.chipsBalance,
    note: 'Daily login bonus',
  })
  // Volume / streak / PAS thresholds may already be satisfied; check once.
  try { await evaluateBadges(prisma, user.id) } catch (e) {
    console.error('badge evaluation failed', e)
  }
  return {
    credited: DAILY_BONUS_AMOUNT,
    balance: updated.chipsBalance,
    nextEligibleAt: now.getTime() + DAILY_BONUS_COOLDOWN_MS,
  }
}

// Lifecycle action surface — what the user needs to act on across all of
// their markets. Used by the Portfolio "Action center" and the nav badge.
// Three buckets:
//   - claimable: positions on RESOLVED markets where this user holds the
//     winning outcome and hasn't claimed yet.
//   - needsProposal: LIVE markets owned by this user whose endTime has
//     passed — they're waiting on the owner to propose a winner.
//   - openDisputes: PROPOSED markets the user has any stake in, whose
//     disputeUntil hasn't lapsed yet. So they can chime in if the
//     proposed outcome looks wrong.
async function getLifecycleActions(userHandle) {
  const user = await ensureUser(userHandle)
  const now = new Date()

  const [claimableRows, needsProposalRows, openDisputeRows] = await Promise.all([
    prisma.sharePosition.findMany({
      where: {
        userId: user.id,
        claimed: false,
        shares: { gt: 0 },
        market: { status: 'RESOLVED' },
      },
      include: { market: true },
    }),
    prisma.market.findMany({
      where: { ownerId: user.id, status: 'LIVE', endTime: { lte: now } },
      select: { id: true, description: true, endTime: true },
      orderBy: { endTime: 'asc' },
    }),
    prisma.market.findMany({
      where: {
        status: 'PROPOSED',
        disputeUntil: { gt: now },
        positions: { some: { userId: user.id, shares: { gt: 0 } } },
      },
      select: {
        id: true,
        description: true,
        disputeUntil: true,
        proposedOutcomeIndex: true,
        outcomes: { orderBy: { index: 'asc' }, select: { name: true, index: true } },
      },
      orderBy: { disputeUntil: 'asc' },
    }),
  ])

  const claimable = claimableRows
    .filter(p => p.outcomeIndex === p.market.resolvedOutcomeIndex)
    .map(p => ({
      marketId: p.marketId,
      description: p.market.description,
      potentialPayout: p.shares,  // 1 chip per winning share
    }))
  const claimableTotal = claimable.reduce((s, c) => s + c.potentialPayout, 0)

  return {
    claimable: { count: claimable.length, totalChips: claimableTotal, items: claimable },
    needsProposal: {
      count: needsProposalRows.length,
      items: needsProposalRows.map(m => ({
        marketId: m.id,
        description: m.description,
        endTime: m.endTime,
      })),
    },
    openDisputes: {
      count: openDisputeRows.length,
      items: openDisputeRows.map(m => ({
        marketId: m.id,
        description: m.description,
        disputeUntil: m.disputeUntil,
        proposedOutcome: m.outcomes.find(o => o.index === m.proposedOutcomeIndex)?.name ?? null,
      })),
    },
    total: claimable.length + needsProposalRows.length + openDisputeRows.length,
  }
}

// Claim every unclaimed winning position in one shot. Used by the
// "Claim all" button so users don't have to chase each market.
async function claimAllPayouts(userHandle) {
  const actions = await getLifecycleActions(userHandle)
  let totalPayout = 0
  let totalPnL = 0
  let claimedMarkets = 0
  let balance = null
  for (const item of actions.claimable.items) {
    const r = await claimPayout({ userHandle, marketId: item.marketId })
    if (r.payout > 0) {
      totalPayout += r.payout
      totalPnL += r.pnl ?? 0
      claimedMarkets += 1
    }
    balance = r.balance
  }
  return { claimedMarkets, totalPayout, totalPnL, balance }
}

async function getPositions(userHandle) {
  const user = await ensureUser(userHandle)
  const rows = await prisma.sharePosition.findMany({
    where: { userId: user.id, shares: { gt: 0 } },
    include: {
      market: { include: { outcomes: { orderBy: { index: 'asc' } } } },
    },
  })
  return rows.map(p => {
    const m = p.market
    const name = m.outcomes.find(o => o.index === p.outcomeIndex)?.name ?? '?'
    const q = m.outcomes.map(o => o.sharesOutstanding)
    const pct = forMarket(m).prices(q)[p.outcomeIndex] ?? 0
    // Mark-to-market: each share is worth ~current price (chips) today; if market wins, 1 chip.
    const markValue = p.shares * pct
    const resolved = m.status === 'RESOLVED'
    const won = resolved && m.resolvedOutcomeIndex === p.outcomeIndex
    return {
      marketId: m.id,
      description: m.description,
      category: m.category,
      outcomeIndex: p.outcomeIndex,
      outcomeName: name,
      shares: p.shares,
      chipsSpent: p.chipsSpent,
      avgCost: p.shares > 0 ? p.chipsSpent / p.shares : 0,
      markPrice: pct,
      markValue,
      potentialPayout: p.shares, // 1 chip per share if this outcome wins
      unrealizedPnL: markValue - p.chipsSpent,
      status: m.status,
      resolved,
      won,
      claimable: won && !p.claimed,
      claimed: p.claimed,
    }
  })
}

// Leaderboard supports multiple sort dimensions:
//   ?by=balance  → richest                              (default)
//   ?by=pas      → highest skill rating (min 5 graded trades)
//   ?by=pnl      → best lifetime realized PnL
//   ?by=streak   → current correct streak
async function getLeaderboard({ by = 'balance', limit = 50 } = {}) {
  const fieldMap = {
    balance: { chipsBalance: 'desc' },
    pas: { pasRating: 'desc' },
    pnl: { totalPnL: 'desc' },
    streak: { streak: 'desc' },
  }
  const orderBy = fieldMap[by] || fieldMap.balance
  const where = by === 'pas' ? { gradedTrades: { gte: 5 } } : {}
  const users = await prisma.user.findMany({ where, orderBy, take: limit })
  return users.map(u => ({
    user: u.handle,
    balance: u.chipsBalance,
    pasRating: Math.round(u.pasRating),
    pasPeak: Math.round(u.pasPeak),
    accuracy: u.gradedTrades ? u.correctTrades / u.gradedTrades : null,
    gradedTrades: u.gradedTrades,
    streak: u.streak,
    longestStreak: u.longestStreak,
    pnl: u.totalPnL,
    tier: u.tier,
  }))
}

// User skill report: PAS, mean Brier, mean log-loss, accuracy, streaks.
async function getScoringReport(handle) {
  const user = await ensureUser(handle)
  const n = user.gradedTrades
  return {
    user: user.handle,
    tier: user.tier,
    pasRating: Math.round(user.pasRating * 100) / 100,
    pasPeak: Math.round(user.pasPeak * 100) / 100,
    gradedTrades: n,
    accuracy: n ? user.correctTrades / n : null,
    meanBrier: n ? user.brierSum / n : null,
    meanLogLoss: n ? user.logScoreSum / n : null,
    streak: user.streak,
    longestStreak: user.longestStreak,
    xp: user.xp,
    totalStaked: user.totalStaked,
    totalPnL: user.totalPnL,
  }
}

// Calibration report: bin all of a user's *graded* trades by stated
// probability and run ECE / MCE / Murphy decomposition.
async function getCalibrationReport(handle, numBins = 10) {
  const user = await ensureUser(handle)
  const trades = await prisma.trade.findMany({
    where: { userId: user.id, graded: true },
    select: { avgFillPrice: true, isCorrect: true },
  })
  const points = trades.map(t => ({
    probability: t.avgFillPrice,
    outcome: t.isCorrect ? 1 : 0,
  }))
  return calibrationReport(points, numBins)
}

// Recent ledger entries for a user.
async function getTransactions(handle, limit = 50) {
  const user = await ensureUser(handle)
  return prisma.coinTransaction.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

// User's earned badges + every badge they could still earn.
async function getBadges(handle) {
  const user = await ensureUser(handle)
  const all = await prisma.badge.findMany({ orderBy: { id: 'asc' } })
  const earned = await prisma.userBadge.findMany({
    where: { userId: user.id },
    include: { badge: true },
  })
  const earnedIds = new Set(earned.map(e => e.badgeId))
  return {
    earned: earned.map(e => ({
      slug: e.badge.slug,
      name: e.badge.name,
      description: e.badge.description,
      iconName: e.badge.iconName,
      earnedAt: e.earnedAt,
    })),
    available: all.filter(b => !earnedIds.has(b.id)).map(b => ({
      slug: b.slug,
      name: b.name,
      description: b.description,
      conditionType: b.conditionType,
      threshold: b.threshold,
      iconName: b.iconName,
    })),
  }
}

module.exports = {
  prisma,
  ensureUser,
  getBalance,
  getMarketState,
  listMarkets,
  getMarket,
  createMarket,
  tradeBuy,
  tradeSell,
  previewTrade,
  previewSell,
  proposeResolution,
  disputeResolution,
  finalizeResolution,
  gradeAllTrades,
  claimPayout,
  claimAllPayouts,
  claimDailyBonus,
  getLifecycleActions,
  getPositions,
  getLeaderboard,
  getScoringReport,
  getCalibrationReport,
  getTransactions,
  getBadges,
}
