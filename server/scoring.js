// scoring.js — proper scoring rules and PAS rating math.
//
// Two distinct measurement frameworks live here. Don't conflate them.
//
// 1. PROPER SCORING RULES (Brier, log loss). Designed for forecasters who
//    *report* a probability. They are minimised in expectation iff the
//    forecaster reports their true belief. We use these for calibration
//    analysis (calibration.js) — "when the market priced an event at p,
//    did it happen with frequency p?"
//
//      Brier(p, y)   = (y - p)^2                    in [0, 1]
//      LogLoss(p, y) = -[y·ln(p) + (1-y)·ln(1-p)]   in [0, ∞)
//
// 2. BETTING-MARKET PnL (PAS). LMSR users do not report probabilities;
//    they buy shares at a price `p` and receive 1 chip per share if their
//    outcome wins. Realised PnL per share is therefore `(y - p)` ∈ [-1, 1].
//    A trader who is consistently better than the market at the moment
//    they trade has positive expected PnL. PAS captures exactly that:
//
//      ΔPAS = K · (y - p) · stakeWeight(chips)
//      stakeWeight(chips) = sqrt(chips / TYPICAL_STAKE)
//
//    Properties:
//      • Reduces to the chat's "expected vs actual" intuition: bet YES at
//        20% and win → +0.80·K (big contrarian reward); bet YES at 80%
//        and win → +0.20·K (small reward); bet YES at 80% and lose →
//        -0.80·K (heavy penalty for confident wrong).
//      • Linear in PnL per share, so PAS tracks economic skill exactly.
//      • Sub-linear in stake (Kelly-flavoured) so a whale can't dominate.
//      • Symmetric: average ΔPAS at a fair price (p = true_prob) is 0.

const K = 40                  // Elo sensitivity per typical-stake unit
const TYPICAL_STAKE = 100     // chips; weight = 1 at this stake
const EPS = 1e-9              // log clamp, avoids -Inf at p∈{0,1}

// Clamp probability strictly inside (0, 1) so log-loss stays finite.
function clampProb(p) {
  if (!isFinite(p)) return 0.5
  if (p < EPS) return EPS
  if (p > 1 - EPS) return 1 - EPS
  return p
}

// --- Proper scoring rules (calibration framework) ----------------------------

function brierLoss(p, y) {
  const pc = clampProb(p)
  return (y - pc) * (y - pc)
}

function logLoss(p, y) {
  const pc = clampProb(p)
  return y === 1 ? -Math.log(pc) : -Math.log(1 - pc)
}

// Brier Skill Score relative to a uniform-prior baseline of 1/N.
// Used for calibration analysis, NOT for PAS.
function brierSkill(p, y, numOutcomes) {
  const baseline = 1 / Math.max(2, numOutcomes | 0)
  const userLoss = brierLoss(p, y)
  const baseLoss = brierLoss(baseline, y)
  if (baseLoss < EPS) return 0
  return (baseLoss - userLoss) / baseLoss
}

// --- PAS framework (betting-market PnL) --------------------------------------

function stakeWeight(chips) {
  return Math.sqrt(Math.max(0, chips) / TYPICAL_STAKE)
}

// PAS delta for a single trade.
// price = chips paid per share for the outcome (∈[0,1] under LMSR).
// won   = whether that outcome resolved true.
// chips = total chips spent on the trade.
function pasDelta({ price, won, chips, k = K }) {
  const p = clampProb(price)
  const y = won ? 1 : 0
  return k * (y - p) * stakeWeight(chips)
}

// Grade a single trade end-to-end. Returns the row patch we'll persist.
// brierLoss / logLoss are recorded per-trade so calibration metrics are
// reproducible from the trade ledger without recomputing.
function gradeTrade({ avgFillPrice, chips, won, numOutcomes }) {
  const y = won ? 1 : 0
  const p = clampProb(avgFillPrice)
  return {
    isCorrect: won,
    brierLoss: brierLoss(p, y),
    logLoss: logLoss(p, y),
    pasDelta: pasDelta({ price: p, won, chips }),
    numOutcomes,
  }
}

// Aggregate user-level metrics from a sequence of graded trades.
// Useful for backfills / tests; live updates are incremental in marketService.
function aggregate(gradedTrades) {
  if (gradedTrades.length === 0) {
    return {
      n: 0, accuracy: 0, meanBrier: 0, meanLogLoss: 0, pasRating: 1500,
    }
  }
  let brier = 0, log = 0, correct = 0, pas = 1500
  for (const t of gradedTrades) {
    brier += t.brierLoss
    log += t.logLoss
    if (t.isCorrect) correct++
    pas += t.pasDelta
  }
  const n = gradedTrades.length
  return {
    n,
    accuracy: correct / n,
    meanBrier: brier / n,
    meanLogLoss: log / n,
    pasRating: pas,
  }
}

// Information-theoretic surprise of a single observation (bits).
// Treats the trade's price as the user's implied probability for the
// outcome. Useful for headline UI: "+X bits of info vs uniform".
function infoBits(p, y, numOutcomes) {
  const pc = clampProb(p)
  const truthProb = y === 1 ? pc : 1 - pc
  const baseline = 1 / Math.max(2, numOutcomes | 0)
  return Math.log2(truthProb / baseline)
}

module.exports = {
  K, TYPICAL_STAKE, EPS,
  clampProb,
  brierLoss,
  logLoss,
  brierSkill,
  stakeWeight,
  pasDelta,
  gradeTrade,
  aggregate,
  infoBits,
}
