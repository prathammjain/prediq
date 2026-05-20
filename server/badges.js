// badges.js — evaluate which badges a user newly qualifies for and award
// them. Badges are seeded in server/index.js via the Badge table; this
// module only inserts UserBadge rows.
//
// We re-run evaluateBadges() at every "interesting" moment (after grading
// a batch of trades, after a daily bonus, after a trade) so awards happen
// the moment a threshold is crossed. Idempotent: an already-earned badge
// is skipped via the unique (userId, badgeId) constraint.
//
// Conditions implemented:
//   STREAK       — current streak ≥ threshold
//   PAS          — pasRating ≥ threshold
//   VOLUME       — totalStaked ≥ threshold
//   CALIBRATION  — ECE ≤ threshold over ≥ 50 graded trades
//   SPECIAL      — bespoke evaluators keyed by slug
//
// `prisma` is passed in so callers can reuse a transactional client.

const { calibrationReport } = require('./calibration')

async function evaluateBadges(prisma, userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return []

  const allBadges = await prisma.badge.findMany()
  const alreadyEarned = await prisma.userBadge.findMany({
    where: { userId },
    select: { badgeId: true },
  })
  const ownedIds = new Set(alreadyEarned.map(r => r.badgeId))

  const newlyEarned = []
  for (const b of allBadges) {
    if (ownedIds.has(b.id)) continue
    const earned = await checkCondition(prisma, user, b)
    if (earned) {
      await prisma.userBadge.create({
        data: { userId, badgeId: b.id },
      })
      newlyEarned.push({ slug: b.slug, name: b.name })
    }
  }
  return newlyEarned
}

async function checkCondition(prisma, user, badge) {
  switch (badge.conditionType) {
    case 'STREAK':
      return user.streak >= (badge.threshold ?? Infinity)

    case 'PAS':
      return user.pasRating >= (badge.threshold ?? Infinity)

    case 'VOLUME':
      return user.totalStaked >= (badge.threshold ?? Infinity)

    case 'CALIBRATION': {
      // Only meaningful with a reasonable sample.
      if (user.gradedTrades < 50) return false
      const trades = await prisma.trade.findMany({
        where: { userId: user.id, graded: true },
        select: { avgFillPrice: true, isCorrect: true },
      })
      const points = trades.map(t => ({
        probability: t.avgFillPrice,
        outcome: t.isCorrect ? 1 : 0,
      }))
      const report = calibrationReport(points)
      return report.ece <= (badge.threshold ?? 0)
    }

    case 'ACCURACY': {
      if (!user.gradedTrades) return false
      const acc = user.correctTrades / user.gradedTrades
      return acc >= (badge.threshold ?? Infinity)
    }

    case 'SPECIAL':
      return checkSpecial(prisma, user, badge)

    default:
      return false
  }
}

// Bespoke evaluators keyed by badge.slug.
async function checkSpecial(prisma, user, badge) {
  switch (badge.slug) {
    case 'contrarian_win': {
      // Won at least one trade where the implied probability was < 0.25.
      const win = await prisma.trade.findFirst({
        where: {
          userId: user.id,
          graded: true,
          isCorrect: true,
          avgFillPrice: { lt: 0.25 },
        },
        select: { id: true },
      })
      return !!win
    }
    default:
      return false
  }
}

module.exports = { evaluateBadges }
