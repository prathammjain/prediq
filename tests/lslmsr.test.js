const {
  cost,
  prices,
  fairProbabilities,
  vig,
  costOfBuying,
  sharesForChips,
  seedSharesForBudget,
  bOf,
} = require('../server/lslmsr')

// Helper: equal-q seed for N outcomes at a given α and target initial b₀.
function uniformSeed(N, alpha, b0 = 500) {
  const q = seedSharesForBudget(b0, alpha, N)
  return new Array(N).fill(q)
}

describe('LS-LMSR — Othman/Pennock/Reeves/Sandholm 2010', () => {
  test('seedSharesForBudget yields b(q) = b₀ exactly', () => {
    const alpha = 0.05
    const N = 3
    const b0 = 500
    const q = uniformSeed(N, alpha, b0)
    expect(bOf(q, alpha)).toBeCloseTo(b0, 9)
  })

  test('At uniform q, fair probabilities are 1/N', () => {
    const alpha = 0.05
    for (const N of [2, 3, 5, 8]) {
      const q = uniformSeed(N, alpha)
      const p = fairProbabilities(q, alpha)
      for (const x of p) expect(x).toBeCloseTo(1 / N, 9)
    }
  })

  test('Instantaneous prices are strictly positive', () => {
    const alpha = 0.05
    const q = [200, 50, 80, 30] // skewed
    const p = prices(q, alpha)
    for (const x of p) expect(x).toBeGreaterThan(0)
  })

  test('Sum of instantaneous prices > 1 (positive vig)', () => {
    const alpha = 0.05
    const q = [200, 50, 80, 30]
    expect(vig(q, alpha)).toBeGreaterThan(0)
  })

  test('Vig grows with α (more aggressive spread)', () => {
    const q = [200, 100]
    const v1 = vig(q, 0.02)
    const v2 = vig(q, 0.10)
    expect(v2).toBeGreaterThan(v1)
  })

  test('Cost is monotone increasing in shares-bought', () => {
    const alpha = 0.05
    const q = uniformSeed(2, alpha)
    let prev = -Infinity
    for (const s of [10, 50, 100, 200, 500]) {
      const c = costOfBuying(q, alpha, 0, s)
      expect(c).toBeGreaterThan(prev)
      prev = c
    }
  })

  test('Buying never exceeds the maximum payoff (1 chip per share)', () => {
    // For a binary market, buying X shares of outcome 0 should cost less
    // than X chips, since at best each share pays out 1 chip on resolution.
    const alpha = 0.05
    const q = uniformSeed(2, alpha)
    for (const shares of [10, 100, 1000, 10000]) {
      const c = costOfBuying(q, alpha, 0, shares)
      expect(c).toBeLessThan(shares)
    }
  })

  test('sharesForChips inverts costOfBuying within tolerance', () => {
    const alpha = 0.05
    const q = uniformSeed(3, alpha)
    for (const chips of [1, 10, 100, 500, 1500]) {
      const s = sharesForChips(q, alpha, 1, chips)
      const recovered = costOfBuying(q, alpha, 1, s)
      expect(recovered).toBeCloseTo(chips, 4)
    }
  })

  test('Buying a single outcome pushes its fair probability up, others down', () => {
    const alpha = 0.05
    const q = uniformSeed(3, alpha)
    const before = fairProbabilities(q, alpha)
    const shares = sharesForChips(q, alpha, 0, 200)
    const qAfter = q.slice(); qAfter[0] += shares
    const after = fairProbabilities(qAfter, alpha)
    expect(after[0]).toBeGreaterThan(before[0])
    expect(after[1]).toBeLessThan(before[1])
    expect(after[2]).toBeLessThan(before[2])
  })

  test('Liquidity parameter b grows as shares are purchased', () => {
    const alpha = 0.05
    const q = uniformSeed(2, alpha)
    const b0 = bOf(q, alpha)
    const shares = sharesForChips(q, alpha, 0, 1000)
    const qAfter = q.slice(); qAfter[0] += shares
    expect(bOf(qAfter, alpha)).toBeGreaterThan(b0)
  })

  test('Throws if q sums to zero (b would be undefined)', () => {
    expect(() => cost([0, 0], 0.05)).toThrow(/Σq > 0/)
  })

  test('Numerically stable for large q (no overflow)', () => {
    const alpha = 0.05
    const q = [1e6, 5e5, 5e5]
    const c = cost(q, alpha)
    expect(Number.isFinite(c)).toBe(true)
    const p = prices(q, alpha)
    for (const x of p) expect(Number.isFinite(x)).toBe(true)
  })
})
