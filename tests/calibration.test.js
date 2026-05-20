const { bin, ece, mce, murphy, calibrationReport } = require('../server/calibration')

// Helper: build N predictions where every prediction has the same prob,
// and a fraction `freq` of them resolve true.
function uniformBatch(prob, freq, n) {
  const out = []
  const k = Math.round(freq * n)
  for (let i = 0; i < n; i++) {
    out.push({ probability: prob, outcome: i < k ? 1 : 0 })
  }
  return out
}

describe('calibration — binning', () => {
  test('A perfectly calibrated single-bin set has ECE = 0', () => {
    const trades = uniformBatch(0.7, 0.7, 100)
    const bins = bin(trades, 10)
    expect(ece(bins, trades.length)).toBeCloseTo(0, 6)
  })

  test('Predicting 0.9 when truth is 0.5 has ECE = 0.4', () => {
    const trades = uniformBatch(0.9, 0.5, 100)
    const bins = bin(trades, 10)
    expect(ece(bins, trades.length)).toBeCloseTo(0.4, 6)
  })

  test('p=1.0 lands in the top bin (no off-by-one)', () => {
    const trades = [{ probability: 1.0, outcome: 1 }]
    const bins = bin(trades, 10)
    expect(bins[9].count).toBe(1)
  })

  test('MCE picks up the worst-calibrated bin', () => {
    const trades = [
      ...uniformBatch(0.1, 0.1, 50),  // perfect
      ...uniformBatch(0.9, 0.5, 50),  // off by 0.4
    ]
    const bins = bin(trades, 10)
    expect(mce(bins)).toBeCloseTo(0.4, 6)
  })
})

describe('calibration — Murphy decomposition', () => {
  test('Brier ≈ Reliability − Resolution + Uncertainty (identity)', () => {
    const trades = [
      ...uniformBatch(0.1, 0.05, 100),
      ...uniformBatch(0.4, 0.4, 100),
      ...uniformBatch(0.7, 0.6, 100),
      ...uniformBatch(0.95, 0.9, 100),
    ]
    const m = murphy(trades, 10)
    expect(m.decomposition).toBeCloseTo(m.brier, 6)
  })

  test('Constant base-rate forecasts have 0 resolution', () => {
    // Always predict the empirical base rate => no discrimination.
    const trades = uniformBatch(0.4, 0.4, 200)
    const m = murphy(trades, 10)
    expect(m.resolution).toBeCloseTo(0, 6)
  })

  test('Perfect classifier (prob 0/1 matching outcome) has Brier = 0', () => {
    const trades = []
    for (let i = 0; i < 50; i++) trades.push({ probability: 1, outcome: 1 })
    for (let i = 0; i < 50; i++) trades.push({ probability: 0, outcome: 0 })
    const m = murphy(trades, 10)
    expect(m.brier).toBeCloseTo(0, 6)
    expect(m.reliability).toBeCloseTo(0, 6)
  })
})

describe('calibration — full report', () => {
  test('Empty trade set returns total=0 and zero metrics', () => {
    const r = calibrationReport([])
    expect(r.total).toBe(0)
    expect(r.ece).toBe(0)
    expect(r.brier).toBe(0)
  })

  test('Returns the requested number of bins', () => {
    const r = calibrationReport(uniformBatch(0.5, 0.5, 10), 20)
    expect(r.bins.length).toBe(20)
  })
})
