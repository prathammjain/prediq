// adaptiveLiquidity.js — volume-aware LMSR liquidity parameter.
//
// LMSR's worst-case subsidy (the maximum chips the market maker can lose)
// is bounded by  b · ln(N)  where N is the number of outcomes. Static b
// works fine at low volume but becomes too sensitive once a market is
// busy: small trades start swinging the displayed probability by tens of
// percentage points, which feels broken to users.
//
// Manifold-style fix: let b grow with cumulative volume.
//
//   b(V) = b0 · ( 1 + α · sqrt(V / b0) )
//
// where V is total absolute shares traded. Properties:
//   • monotonically increasing
//   • starts at exactly b0 (preserves initial UX for new markets)
//   • grows on the order of sqrt(V) — slippage stays bounded as activity
//     scales by orders of magnitude
//   • α is a single tunable; default 0.25 ≈ "double b at V = 16·b0".

const DEFAULT_ALPHA = 0.25

// Recommended b given the market's initial b0 and total absolute share
// volume traded so far.
function recommendedB(b0, totalVolume, alpha = DEFAULT_ALPHA) {
  const v = Math.max(0, totalVolume)
  return b0 * (1 + alpha * Math.sqrt(v / b0))
}

// Returns the worst-case subsidy (chips the LMSR market maker stands to
// lose in the worst outcome) for a given b and N.
function maxSubsidy(b, numOutcomes) {
  return b * Math.log(Math.max(2, numOutcomes))
}

module.exports = { DEFAULT_ALPHA, recommendedB, maxSubsidy }
