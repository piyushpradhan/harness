import { describe, expect, it } from 'vitest'

import { summarizeFrames } from './bench-probe'

describe('summarizeFrames', () => {
  it('reports nothing when there are too few intervals to establish a period', () => {
    expect(summarizeFrames([])).toEqual({ period: 0, dropped: 0 })
    expect(summarizeFrames([16.7])).toEqual({ period: 0, dropped: 0 })
  })

  it('counts no dropped frames for a steady 60 Hz stream', () => {
    const steady = Array.from({ length: 60 }, () => 16.7)
    expect(summarizeFrames(steady)).toEqual({ period: 16.7, dropped: 0 })
  })

  it('counts an interval longer than 1.5x the period as dropped', () => {
    const intervals = [...Array.from({ length: 10 }, () => 16), 50, 16, 33.4]
    const { dropped } = summarizeFrames(intervals)
    // 50 ms and 33.4 ms both exceed 24 ms; 16 ms never does.
    expect(dropped).toBe(2)
  })

  it('calibrates the period from the data, so 120 Hz is not all drops', () => {
    const proMotion = Array.from({ length: 60 }, () => 8.3)
    expect(summarizeFrames(proMotion)).toEqual({ period: 8.3, dropped: 0 })
  })

  it('does not mutate its input', () => {
    const intervals = [50, 16, 16, 16]
    summarizeFrames(intervals)
    expect(intervals).toEqual([50, 16, 16, 16])
  })
})
