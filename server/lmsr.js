// LMSR (Logarithmic Market Scoring Rule) — Hanson's automated market maker.
// This is what Polymarket-class prediction markets use for smooth, live pricing.
//
// Given:
//   q[]  shares outstanding per outcome
//   b    liquidity parameter
//
// Cost function:   C(q) = b * ln( Σ exp(q_i / b) )
// Price of i:      p_i = exp(q_i / b) / Σ exp(q_j / b)
// Trade cost:      chipsToPay = C(q + Δ·e_i) - C(q)
//
// For numerical stability we subtract max(q)/b before exp().

function cost(q, b) {
  const scaled = q.map(s => s / b)
  const m = Math.max(...scaled)
  const sumExp = scaled.reduce((acc, s) => acc + Math.exp(s - m), 0)
  return b * (m + Math.log(sumExp))
}

function prices(q, b) {
  const scaled = q.map(s => s / b)
  const m = Math.max(...scaled)
  const exps = scaled.map(s => Math.exp(s - m))
  const total = exps.reduce((a, x) => a + x, 0)
  return exps.map(e => e / total)
}

// Cost of buying `shares` shares of outcome `idx` given current state q.
function costOfBuying(q, b, idx, shares) {
  const qAfter = q.slice()
  qAfter[idx] = qAfter[idx] + shares
  return cost(qAfter, b) - cost(q, b)
}

// Refund (chips returned) for selling `shares` shares of outcome `idx`.
// Always non-negative: cost is monotone increasing in q[idx].
//   refund = C(q) − C(q with shares removed)
function refundForSelling(q, b, idx, shares) {
  if (shares <= 0) return 0
  if (shares > q[idx]) return NaN  // caller must validate; we don't go negative
  const qAfter = q.slice()
  qAfter[idx] = qAfter[idx] - shares
  return cost(q, b) - cost(qAfter, b)
}

// Given `chipsToSpend`, solve for the number of shares of `idx` that will be purchased.
// Binary search (cost is monotone increasing in shares).
function sharesForChips(q, b, idx, chipsToSpend, tolerance = 1e-6, maxIter = 80) {
  if (chipsToSpend <= 0) return 0
  let lo = 0
  let hi = Math.max(chipsToSpend * 5, b) // initial upper bound; doubles as needed
  for (let i = 0; i < 40; i++) {
    if (costOfBuying(q, b, idx, hi) >= chipsToSpend) break
    hi *= 2
  }
  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2
    const c = costOfBuying(q, b, idx, mid)
    if (Math.abs(c - chipsToSpend) < tolerance) return mid
    if (c < chipsToSpend) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

module.exports = { cost, prices, costOfBuying, refundForSelling, sharesForChips }
