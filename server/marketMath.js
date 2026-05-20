// marketMath.js — thin adapter that selects the right pricing model
// (classic LMSR or LS-LMSR) for a given Market record.
//
// Existing markets store `useLsLmsr = false` and continue to use
// lmsr.js with their static `liquidityB`. Markets created with
// `useLsLmsr = true` use lslmsr.js with `lsAlpha`; b is computed from
// the live share state.
//
// Each adapter exposes the same four functions plus a `prices` array
// (instantaneous-price for the classic model, fair-probability vector
// for the LS-LMSR model — both are arrays summing to ≈1 for UI use).

const lmsr = require('./lmsr')
const ls = require('./lslmsr')

function forMarket(market) {
  if (market.useLsLmsr) {
    const alpha = market.lsAlpha
    return {
      mode: 'LS_LMSR',
      cost: (q) => ls.cost(q, alpha),
      // For UI/API we expose normalised fair probabilities (sum to 1).
      // The vig (Σ raw prices − 1) is queryable via `vig`.
      prices: (q) => ls.fairProbabilities(q, alpha),
      vig: (q) => ls.vig(q, alpha),
      costOfBuying: (q, idx, shares) => ls.costOfBuying(q, alpha, idx, shares),
      refundForSelling: (q, idx, shares) => ls.refundForSelling(q, alpha, idx, shares),
      sharesForChips: (q, idx, chips) => ls.sharesForChips(q, alpha, idx, chips),
      effectiveB: (q) => ls.bOf(q, alpha),
    }
  }
  const b = market.liquidityB
  return {
    mode: 'LMSR',
    cost: (q) => lmsr.cost(q, b),
    prices: (q) => lmsr.prices(q, b),
    vig: () => 0,
    costOfBuying: (q, idx, shares) => lmsr.costOfBuying(q, b, idx, shares),
    refundForSelling: (q, idx, shares) => lmsr.refundForSelling(q, b, idx, shares),
    sharesForChips: (q, idx, chips) => lmsr.sharesForChips(q, b, idx, chips),
    effectiveB: () => b,
  }
}

module.exports = { forMarket }
