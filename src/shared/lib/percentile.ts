/**
 * Nearest-rank percentile: the value below which `p` percent of the data falls.
 * Used by the bench rig for p50/p99 delta-to-paint latency budgets.
 *
 * Does not mutate the input. `p = 50` is the median, `p = 100` the max.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    throw new Error('percentile() requires at least one value')
  }
  if (p < 0 || p > 100) {
    throw new Error('percentile() p must be within [0, 100]')
  }
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length))
  // rank is always >= 1 and <= sorted.length, so this index is in bounds.
  return sorted[rank - 1]!
}
