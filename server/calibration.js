// calibration.js — reliability diagram, ECE, and Murphy decomposition.
//
// A forecaster is *calibrated* if among the events they assigned
// probability p, the empirical frequency is also p. We measure this with:
//
//   ECE (Expected Calibration Error)
//     = Σ_b (n_b / N) · | mean_pred_b − empirical_freq_b |
//
//   MCE (Maximum Calibration Error)
//     = max_b | mean_pred_b − empirical_freq_b |
//
// Murphy (1973) decomposes the Brier score into three components:
//
//   Brier = Reliability − Resolution + Uncertainty
//
//   Reliability  = Σ_b (n_b / N) · (mean_pred_b − empirical_freq_b)^2     (lower better)
//   Resolution   = Σ_b (n_b / N) · (empirical_freq_b − base_rate)^2       (higher better)
//   Uncertainty  = base_rate · (1 − base_rate)                            (intrinsic)
//
// A forecaster who calls everything at the base rate has 0 reliability
// error AND 0 resolution — they are calibrated but uninformative.
// A forecaster with high resolution discriminates events well; combining
// the two is what we actually reward.

const DEFAULT_BINS = 10

// Bucket trades by stated probability into `numBins` equal-width bins on
// [0, 1]. Each input is { probability, outcome } where outcome ∈ {0,1}.
function bin(trades, numBins = DEFAULT_BINS) {
  const bins = Array.from({ length: numBins }, (_, i) => ({
    index: i,
    lo: i / numBins,
    hi: (i + 1) / numBins,
    n: 0,
    sumPred: 0,
    sumOutcome: 0,
  }))
  for (const t of trades) {
    const p = Math.max(0, Math.min(1, t.probability))
    let idx = Math.floor(p * numBins)
    if (idx === numBins) idx = numBins - 1   // p === 1 falls into top bin
    const b = bins[idx]
    b.n += 1
    b.sumPred += p
    b.sumOutcome += t.outcome ? 1 : 0
  }
  return bins.map(b => ({
    bin: b.index,
    range: [b.lo, b.hi],
    count: b.n,
    meanPredicted: b.n ? b.sumPred / b.n : null,
    empiricalFreq: b.n ? b.sumOutcome / b.n : null,
  }))
}

function ece(bins, total) {
  if (!total) return 0
  let acc = 0
  for (const b of bins) {
    if (!b.count) continue
    acc += (b.count / total) * Math.abs(b.meanPredicted - b.empiricalFreq)
  }
  return acc
}

function mce(bins) {
  let m = 0
  for (const b of bins) {
    if (!b.count) continue
    const d = Math.abs(b.meanPredicted - b.empiricalFreq)
    if (d > m) m = d
  }
  return m
}

// Murphy decomposition. Returns { reliability, resolution, uncertainty,
// brier } such that brier ≈ reliability − resolution + uncertainty.
function murphy(trades, numBins = DEFAULT_BINS) {
  const N = trades.length
  if (N === 0) {
    return { reliability: 0, resolution: 0, uncertainty: 0, brier: 0 }
  }
  const baseRate = trades.reduce((a, t) => a + (t.outcome ? 1 : 0), 0) / N
  const uncertainty = baseRate * (1 - baseRate)
  const bins = bin(trades, numBins)
  let reliability = 0
  let resolution = 0
  for (const b of bins) {
    if (!b.count) continue
    const w = b.count / N
    reliability += w * (b.meanPredicted - b.empiricalFreq) ** 2
    resolution += w * (b.empiricalFreq - baseRate) ** 2
  }
  // Direct Brier for sanity.
  const brierDirect = trades.reduce((a, t) => {
    const d = (t.outcome ? 1 : 0) - t.probability
    return a + d * d
  }, 0) / N
  return {
    reliability,
    resolution,
    uncertainty,
    brier: brierDirect,
    decomposition: reliability - resolution + uncertainty,
  }
}

// One-shot summary used by the API.
function calibrationReport(trades, numBins = DEFAULT_BINS) {
  const N = trades.length
  const bins = bin(trades, numBins)
  return {
    total: N,
    bins,
    ece: ece(bins, N),
    mce: mce(bins),
    ...murphy(trades, numBins),
  }
}

module.exports = {
  DEFAULT_BINS,
  bin,
  ece,
  mce,
  murphy,
  calibrationReport,
}
