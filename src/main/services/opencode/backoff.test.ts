import { describe, expect, it } from 'vitest'

import { exponentialDelay, fullJitterDelay } from './backoff'

describe('exponentialDelay', () => {
  it('starts at the base delay', () => {
    expect(exponentialDelay(0, 1_000, 30_000)).toBe(1_000)
  })

  it('doubles with each attempt', () => {
    expect([1, 2, 3, 4].map((n) => exponentialDelay(n, 1_000, 30_000))).toEqual([
      2_000, 4_000, 8_000, 16_000,
    ])
  })

  it('is capped at the maximum', () => {
    expect(exponentialDelay(5, 1_000, 30_000)).toBe(30_000)
  })

  it('stays capped for attempt counts that overflow a double', () => {
    expect(exponentialDelay(5_000, 1_000, 30_000)).toBe(30_000)
  })
})

describe('fullJitterDelay', () => {
  it('scales the capped exponential delay by the random draw', () => {
    expect(fullJitterDelay(2, 1_000, 30_000, () => 0.5)).toBe(2_000)
  })

  it('can be zero', () => {
    expect(fullJitterDelay(3, 1_000, 30_000, () => 0)).toBe(0)
  })

  it('never reaches the cap', () => {
    expect(fullJitterDelay(20, 1_000, 30_000, () => 0.999_999)).toBeLessThan(30_000)
  })
})
