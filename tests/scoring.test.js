const {
  brierLoss,
  logLoss,
  brierSkill,
  pasDelta,
  gradeTrade,
  aggregate,
  infoBits,
  clampProb,
  K,
  TYPICAL_STAKE,
} = require('../server/scoring')

describe('scoring — proper scoring rules (calibration framework)', () => {
  test('Brier loss is 0 for a perfectly confident correct call', () => {
    expect(brierLoss(1, 1)).toBeCloseTo(0, 9)
    expect(brierLoss(0, 0)).toBeCloseTo(0, 9)
  })

  test('Brier loss is ~1 for a perfectly confident wrong call (modulo clamping)', () => {
    expect(brierLoss(1, 0)).toBeGreaterThan(0.99)
    expect(brierLoss(0, 1)).toBeGreaterThan(0.99)
  })

  test('Brier loss at 0.5 is 0.25 regardless of outcome', () => {
    expect(brierLoss(0.5, 0)).toBeCloseTo(0.25, 9)
    expect(brierLoss(0.5, 1)).toBeCloseTo(0.25, 9)
  })

  test('Log loss matches -ln(p_truth)', () => {
    expect(logLoss(0.7, 1)).toBeCloseTo(-Math.log(0.7), 9)
    expect(logLoss(0.7, 0)).toBeCloseTo(-Math.log(0.3), 9)
  })

  test('Log loss is finite at p∈{0,1} due to clamp', () => {
    expect(Number.isFinite(logLoss(0, 1))).toBe(true)
    expect(Number.isFinite(logLoss(1, 0))).toBe(true)
  })

  test('clampProb is monotonic and idempotent inside (eps, 1-eps)', () => {
    expect(clampProb(0.4)).toBe(0.4)
    expect(clampProb(0)).toBeGreaterThan(0)
    expect(clampProb(1)).toBeLessThan(1)
    expect(clampProb(NaN)).toBe(0.5)
  })

  test('Brier Skill: predicting baseline (1/N) yields 0 skill', () => {
    expect(brierSkill(0.5, 1, 2)).toBeCloseTo(0, 9)
    expect(brierSkill(0.25, 1, 4)).toBeCloseTo(0, 9)
  })

  test('Brier Skill: confident correct beats baseline', () => {
    expect(brierSkill(0.8, 1, 2)).toBeGreaterThan(0)
  })
})

describe('scoring — PAS (betting-market PnL framework)', () => {
  test('Sign is positive on correct, negative on wrong', () => {
    const right = pasDelta({ price: 0.7, won: true,  chips: TYPICAL_STAKE })
    const wrong = pasDelta({ price: 0.7, won: false, chips: TYPICAL_STAKE })
    expect(right).toBeGreaterThan(0)
    expect(wrong).toBeLessThan(0)
  })

  test('Contrarian win pays more than safe win (linear in 1-p)', () => {
    // bet YES at 20% and YES wins — big PnL per share
    const contrarian = pasDelta({ price: 0.2, won: true, chips: TYPICAL_STAKE })
    // bet YES at 80% and YES wins — small PnL per share
    const safe       = pasDelta({ price: 0.8, won: true, chips: TYPICAL_STAKE })
    expect(contrarian).toBeGreaterThan(safe)
    expect(contrarian / safe).toBeCloseTo(0.8 / 0.2, 5) // = 4
  })

  test('Confident wrong is penalised more than uncertain wrong', () => {
    // bet YES at 80% but NO wins — heavy loss
    const confidentWrong = pasDelta({ price: 0.8, won: false, chips: TYPICAL_STAKE })
    // bet YES at 20% but NO wins — tiny loss
    const uncertainWrong = pasDelta({ price: 0.2, won: false, chips: TYPICAL_STAKE })
    expect(Math.abs(confidentWrong)).toBeGreaterThan(Math.abs(uncertainWrong))
  })

  test('Stake weight scales as sqrt(chips/typical)', () => {
    const small = pasDelta({ price: 0.7, won: true, chips: TYPICAL_STAKE })
    const big   = pasDelta({ price: 0.7, won: true, chips: 4 * TYPICAL_STAKE })
    expect(big / small).toBeCloseTo(2, 5)  // 4× chips ⇒ 2× weight ⇒ 2× delta
  })

  test('Bounded magnitude (|delta| ≤ K · stakeWeight)', () => {
    for (const price of [0.01, 0.5, 0.99]) {
      for (const won of [true, false]) {
        const d = pasDelta({ price, won, chips: TYPICAL_STAKE })
        expect(Math.abs(d)).toBeLessThanOrEqual(K + 1e-6)
      }
    }
  })

  test('Expected delta at fair price is zero (no edge ⇒ no rating drift)', () => {
    // If true_prob = price, expected delta over many trades is zero.
    const price = 0.4
    const win = pasDelta({ price, won: true,  chips: TYPICAL_STAKE })
    const lose = pasDelta({ price, won: false, chips: TYPICAL_STAKE })
    const expected = price * win + (1 - price) * lose
    expect(expected).toBeCloseTo(0, 9)
  })
})

describe('scoring — gradeTrade and aggregate', () => {
  test('gradeTrade returns finite numbers and correct flags', () => {
    const g = gradeTrade({ avgFillPrice: 0.4, chips: 100, won: true, numOutcomes: 2 })
    expect(Number.isFinite(g.brierLoss)).toBe(true)
    expect(Number.isFinite(g.logLoss)).toBe(true)
    expect(Number.isFinite(g.pasDelta)).toBe(true)
    expect(g.isCorrect).toBe(true)
  })

  test('aggregate over 0 trades returns neutral defaults', () => {
    const a = aggregate([])
    expect(a.n).toBe(0)
    expect(a.pasRating).toBe(1500)
  })

  test('A streak of profitable contrarian calls drives PAS up', () => {
    const trades = [
      gradeTrade({ avgFillPrice: 0.3, chips: 100, won: true, numOutcomes: 2 }),
      gradeTrade({ avgFillPrice: 0.2, chips: 100, won: true, numOutcomes: 2 }),
      gradeTrade({ avgFillPrice: 0.4, chips: 100, won: true, numOutcomes: 2 }),
    ]
    const a = aggregate(trades)
    expect(a.pasRating).toBeGreaterThan(1500)
    expect(a.accuracy).toBe(1)
  })

  test('A streak of confident wrong calls drives PAS down sharply', () => {
    const trades = [
      gradeTrade({ avgFillPrice: 0.9, chips: 100, won: false, numOutcomes: 2 }),
      gradeTrade({ avgFillPrice: 0.85, chips: 100, won: false, numOutcomes: 2 }),
    ]
    const a = aggregate(trades)
    expect(a.pasRating).toBeLessThan(1500 - 50)
  })
})

describe('scoring — info bits', () => {
  test('Calling baseline yields 0 bits of info', () => {
    expect(infoBits(0.5, 1, 2)).toBeCloseTo(0, 9)
    expect(infoBits(0.25, 1, 4)).toBeCloseTo(0, 9)
  })

  test('Confident correct call yields positive bits', () => {
    expect(infoBits(0.9, 1, 2)).toBeGreaterThan(0)
  })

  test('Confident wrong call yields negative bits', () => {
    expect(infoBits(0.9, 0, 2)).toBeLessThan(0)
  })
})
