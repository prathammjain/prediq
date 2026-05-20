const { recommendedB, maxSubsidy } = require('../server/adaptiveLiquidity')

describe('adaptiveLiquidity', () => {
  test('At zero volume, b is unchanged', () => {
    expect(recommendedB(500, 0)).toBe(500)
  })

  test('b grows monotonically with volume', () => {
    const b0 = 500
    let prev = recommendedB(b0, 0)
    for (const v of [100, 500, 1000, 5000, 10000, 100000]) {
      const next = recommendedB(b0, v)
      expect(next).toBeGreaterThan(prev)
      prev = next
    }
  })

  test('b grows on the order of sqrt(V) at large V', () => {
    const b0 = 500
    const a = recommendedB(b0, 1_000_000) - b0
    const b = recommendedB(b0, 4_000_000) - b0
    // 4x volume => 2x growth
    expect(b / a).toBeCloseTo(2, 1)
  })

  test('Worst-case subsidy bound matches b · ln(N)', () => {
    expect(maxSubsidy(500, 2)).toBeCloseTo(500 * Math.log(2), 6)
    expect(maxSubsidy(500, 4)).toBeCloseTo(500 * Math.log(4), 6)
  })
})
