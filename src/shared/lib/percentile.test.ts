import { describe, expect, it } from 'vitest'

import { percentile } from './percentile'

describe('percentile', () => {
  it('returns the median for p = 50', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3)
  })

  it('returns the min for p = 0 and the max for p = 100', () => {
    expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1)
    expect(percentile([1, 2, 3, 4, 5], 100)).toBe(5)
  })

  it('computes p99 over 100 samples', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(percentile(values, 99)).toBe(99)
  })

  it('is order-independent', () => {
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3)
  })

  it('does not mutate the input', () => {
    const input = [3, 1, 2]
    percentile(input, 50)
    expect(input).toEqual([3, 1, 2])
  })

  it('handles a single value', () => {
    expect(percentile([42], 0)).toBe(42)
    expect(percentile([42], 50)).toBe(42)
    expect(percentile([42], 100)).toBe(42)
  })

  it('throws on an empty array', () => {
    expect(() => percentile([], 50)).toThrow(/at least one value/)
  })

  it('throws when p is out of [0, 100]', () => {
    expect(() => percentile([1], -1)).toThrow(/within \[0, 100\]/)
    expect(() => percentile([1], 101)).toThrow(/within \[0, 100\]/)
  })
})
