import { describe, expect, it } from 'vitest'

import { compare, summarize, type Baseline, type BenchmarkResult } from './bench'

function result(overrides: Partial<BenchmarkResult> = {}): BenchmarkResult {
  return {
    name: 'cold-start',
    platform: 'darwin',
    unit: 'ms',
    budget: 800,
    samples: 5,
    p50: 500,
    p99: 600,
    min: 480,
    max: 600,
    ...overrides,
  }
}

function baseline(results: BenchmarkResult[]): Baseline {
  return { commit: 'abc123', updatedAt: '2026-09-14T00:00:00.000Z', results }
}

describe('summarize', () => {
  it('reports percentiles and extremes over the samples', () => {
    const summary = summarize('cold-start', 'ms', 800, [300, 100, 200, 400, 500], 'darwin')
    expect(summary).toMatchObject({
      platform: 'darwin',
      samples: 5,
      p50: 300,
      p99: 500,
      min: 100,
      max: 500,
    })
  })
})

describe('compare', () => {
  it('passes a benchmark within tolerance of its baseline', () => {
    const comparisons = compare([result({ p50: 550 })], baseline([result({ p50: 500 })]), 0.25)
    expect(comparisons[0].status).toBe('ok')
    expect(comparisons[0].delta).toBeCloseTo(0.1)
  })

  it('flags a p50 that drifts past the tolerance', () => {
    const comparisons = compare([result({ p50: 700 })], baseline([result({ p50: 500 })]), 0.25)
    expect(comparisons[0].status).toBe('regressed')
    expect(comparisons[0].detail).toMatch(/above baseline/)
  })

  it('flags a p99 over budget even when the baseline is unchanged', () => {
    const over = result({ p50: 500, p99: 900, budget: 800 })
    const comparisons = compare([over], baseline([over]), 0.25)
    expect(comparisons[0].status).toBe('over-budget')
  })

  it('treats an improvement as ok', () => {
    const comparisons = compare([result({ p50: 250 })], baseline([result({ p50: 500 })]), 0.25)
    expect(comparisons[0].status).toBe('ok')
    expect(comparisons[0].delta).toBeCloseTo(-0.5)
  })

  it('reports a benchmark with no baseline entry as new', () => {
    const comparisons = compare([result({ name: 'delta-to-paint' })], baseline([result()]), 0.25)
    expect(comparisons[0]).toMatchObject({ status: 'new', baseline: null, delta: null })
  })

  it('does not compare across platforms', () => {
    const comparisons = compare([result({ platform: 'linux' })], baseline([result()]), 0.25)
    expect(comparisons[0].status).toBe('new')
  })

  it('reports every benchmark as new when there is no baseline at all', () => {
    expect(compare([result()], null).map((c) => c.status)).toEqual(['new'])
  })
})
