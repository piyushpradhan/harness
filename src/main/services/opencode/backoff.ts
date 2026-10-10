/**
 * Retry delays. Exponential growth keeps a struggling server from being
 * hammered; full jitter (uniform over the whole window, not ± a little) keeps
 * clients that failed together from retrying together — see "Exponential
 * Backoff And Jitter", AWS Architecture Blog, 2015.
 */

/** `base · 2^attempt`, capped at `maxMs`. `attempt` counts from 0. */
export function exponentialDelay(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(maxMs, baseMs * 2 ** attempt)
}

/** Full jitter: uniform in `[0, exponentialDelay)`. */
export function fullJitterDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  return random() * exponentialDelay(attempt, baseMs, maxMs)
}
