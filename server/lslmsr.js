// Liquidity-Sensitive LMSR (LS-LMSR) — Othman, Pennock, Reeves & Sandholm 2010,
// "A Practical Liquidity-Sensitive Automated Market Maker."
//
// Classic LMSR (lmsr.js) uses a fixed liquidity parameter b. That works,
// but suffers from two well-known issues:
//   1. Picking b is hard. Too small → wild price swings; too large → price
//      barely moves with real money. The right b depends on volume.
//   2. The market maker's worst-case loss is b·log(N) regardless of how
//      much volume goes through. A market that never trades subsidises the
//      same amount as one with millions in volume.
//
// LS-LMSR fixes both by making b a function of the outstanding-share
// vector q:
//
//      b(q) = α · Σᵢ qᵢ       (α > 0 is the only free parameter)
//      C(q) = b(q) · log Σᵢ exp(qᵢ / b(q))
//
// Properties:
//   • b grows linearly with total shares — high-volume markets become
//     deeper automatically; new markets stay snappy.
//   • The market maker collects a small spread ("vig") whose magnitude is
//     controlled by α. Sum-of-instantaneous-prices > 1 — the difference is
//     the maker's fee.
//   • Worst-case loss is bounded by α · S · log(N) where S = Σqᵢ at
//     resolution. As volume rises so does subsidy, but it's now paid out
//     of the spread already collected.
//
// Pricing derivation (used below; see tests/lslmsr.test.js for numerical
// verification):
//
//   Let Z(q) = Σᵢ exp(qᵢ/b),  π_j = exp(q_j/b) / Z   (softmax weights)
//
//   ∂C/∂q_j = α·log(Z) + π_j − (α/b)·E_π[q]
//
// where E_π[q] = Σᵢ q_i · π_i. The first and third terms together encode
// the liquidity-sensitive correction; the middle term is the standard
// LMSR price.
//
// Stability notes:
//   • Subtract max(q_i/b) inside Σ exp(...) for numerical stability.
//   • b = α·S is undefined at S = 0. Callers MUST seed each outcome with
//     a non-zero starting inventory (see seedSharesForBudget below).

// Convenience: total outstanding shares.
function sumQ(q) {
  let s = 0
  for (let i = 0; i < q.length; i++) s += q[i]
  return s
}

// Liquidity parameter at the current state.
function bOf(q, alpha) {
  return alpha * sumQ(q)
}

// log Σ exp(q_i / b)  computed in a numerically-stable way; also returns
// the softmax weights π and the cached value of b for reuse.
function logSumExp(q, alpha) {
  const b = bOf(q, alpha)
  if (b <= 0) {
    throw new Error('LS-LMSR requires Σq > 0; seed each outcome with a positive starting inventory.')
  }
  const scaled = q.map(s => s / b)
  const m = Math.max(...scaled)
  const exps = scaled.map(s => Math.exp(s - m))
  const sumExps = exps.reduce((a, x) => a + x, 0)
  // log(Σ exp(s)) = m + log(Σ exp(s − m))
  const logZ = m + Math.log(sumExps)
  const pi = exps.map(e => e / sumExps)
  return { b, logZ, pi }
}

// Cost function C(q).
function cost(q, alpha) {
  const { b, logZ } = logSumExp(q, alpha)
  return b * logZ
}

// Instantaneous prices p_j = ∂C/∂q_j. These do NOT sum to 1 — the excess
// over 1 is the market maker's spread (vig). Use `fairProbabilities` for
// a normalised probability vector.
function prices(q, alpha) {
  const { b, logZ, pi } = logSumExp(q, alpha)
  // E_π[q] = Σᵢ qᵢ · π_i
  let eqPi = 0
  for (let i = 0; i < q.length; i++) eqPi += q[i] * pi[i]
  const correction = (alpha / b) * eqPi
  return pi.map(p => alpha * logZ + p - correction)
}

// Implied probabilities — instantaneous prices renormalised to sum to 1.
// Useful for UI ("p = 64%") since users expect probabilities.
function fairProbabilities(q, alpha) {
  const p = prices(q, alpha)
  const s = p.reduce((a, x) => a + x, 0)
  return p.map(x => x / s)
}

// Vig (spread) at the current state: Σp_j − 1. This is always ≥ 0.
function vig(q, alpha) {
  const p = prices(q, alpha)
  return p.reduce((a, x) => a + x, 0) - 1
}

// Cost in chips of buying `shares` of outcome `idx`, given current state q.
function costOfBuying(q, alpha, idx, shares) {
  const qAfter = q.slice()
  qAfter[idx] += shares
  return cost(qAfter, alpha) - cost(q, alpha)
}

// Refund (chips returned) for selling `shares` of outcome `idx`. The
// per-outcome floor is the seeded inventory — sales below the seed would
// drive Σq toward zero and break b(q). The service layer should bound
// `shares` to the user's actual holdings (which never include the seed).
function refundForSelling(q, alpha, idx, shares) {
  if (shares <= 0) return 0
  if (shares > q[idx]) return NaN
  const qAfter = q.slice()
  qAfter[idx] -= shares
  return cost(q, alpha) - cost(qAfter, alpha)
}

// Solve for shares given a chip budget. Cost is monotonically increasing in
// shares (LS-LMSR remains a convex cost function), so binary search works.
function sharesForChips(q, alpha, idx, chipsToSpend, tolerance = 1e-6, maxIter = 80) {
  if (chipsToSpend <= 0) return 0
  let lo = 0
  // Starting upper bound: use Σq as a scale. Doubles until it overshoots.
  let hi = Math.max(chipsToSpend * 5, sumQ(q))
  for (let i = 0; i < 60; i++) {
    if (costOfBuying(q, alpha, idx, hi) >= chipsToSpend) break
    hi *= 2
  }
  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2
    const c = costOfBuying(q, alpha, idx, mid)
    if (Math.abs(c - chipsToSpend) < tolerance) return mid
    if (c < chipsToSpend) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

// Helper for createMarket: pick a per-outcome seed inventory so that the
// initial liquidity parameter equals a desired b₀. Spreading shares
// uniformly across outcomes keeps fair probabilities at 1/N.
//
//   b₀ = α · N · q_seed   ⇒   q_seed = b₀ / (α · N)
//
function seedSharesForBudget(b0, alpha, numOutcomes) {
  return b0 / (alpha * numOutcomes)
}

module.exports = {
  cost,
  prices,
  fairProbabilities,
  vig,
  costOfBuying,
  refundForSelling,
  sharesForChips,
  seedSharesForBudget,
  bOf,
}
