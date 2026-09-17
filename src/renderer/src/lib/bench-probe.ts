/**
 * Renderer-side instrumentation for the streaming benchmark.
 *
 * Inert unless the window was loaded with `?bench=stream`, which only
 * `scripts/bench.ts` ever does — the three call sites in the chat screen are
 * no-op function calls in a normal run.
 *
 * What it measures:
 *
 *  - **delta→paint**: `performance.now()` is stamped when a delta arrives over
 *    IPC, and read back in a `requestAnimationFrame` scheduled from a *layout*
 *    effect — so the DOM already carries the change and the browser is about to
 *    paint it. This excludes the compositor's own paint time, exactly like
 *    `ready-to-show` excludes it for `cold-start`. It is a frame-boundary proxy,
 *    and the 32 ms budget in docs/perf-budget.md is two frames wide for that
 *    reason.
 *  - **dropped frames**: a free-running rAF loop records frame intervals. The
 *    display period is taken from the median interval rather than assumed to be
 *    16.7 ms, so a 120 Hz panel does not report every frame as dropped.
 *
 * Samples leave as one `console.log` line, which main forwards to stdout — the
 * same `harness:bench` stdout protocol `cold-start` already uses. No IPC
 * channel, no preload surface, nothing to strip from a production build.
 */

import type { OpencodeStreamEvent } from '@shared/opencode-stream'

export interface FrameStats {
  /** Median frame interval in ms — the observed display period. */
  period: number
  /** Intervals longer than `1.5 ×` the period. */
  dropped: number
}

/**
 * Frame pacing from a list of intervals. Pure, so it can be tested without a
 * browser. Fewer than two intervals is not enough to establish a period.
 */
export function summarizeFrames(intervals: readonly number[]): FrameStats {
  if (intervals.length < 2) return { period: 0, dropped: 0 }
  const sorted = [...intervals].sort((a, b) => a - b)
  const period = sorted[Math.floor(sorted.length / 2)]
  const ceiling = period * 1.5
  return { period, dropped: intervals.filter((interval) => interval > ceiling).length }
}

export interface StreamBenchReport {
  /** One delta→paint latency per received text delta, in ms. */
  latencies: number[]
  deltas: number
  frames: number
  droppedFrames: number
  framePeriod: number
  /** Wall time from the first delta to the `done` event, in ms. */
  durationMs: number
}

// Guarded so `summarizeFrames` stays importable from a plain Node test.
const enabled =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('bench') === 'stream'

const pending: number[] = []
const latencies: number[] = []
const intervals: number[] = []

let deltas = 0
let startedAt = 0
let lastFrame = 0
let rafQueued = false
let reported = false
let submitted = false

function frameLoop(now: number): void {
  if (lastFrame !== 0) intervals.push(now - lastFrame)
  lastFrame = now
  if (!reported) requestAnimationFrame(frameLoop)
}

function drain(): void {
  rafQueued = false
  const now = performance.now()
  for (const stamp of pending) latencies.push(now - stamp)
  pending.length = 0
}

function report(): void {
  if (reported) return
  reported = true
  const frames = summarizeFrames(intervals)
  const payload: StreamBenchReport = {
    latencies,
    deltas,
    frames: intervals.length + 1,
    droppedFrames: frames.dropped,
    framePeriod: frames.period,
    durationMs: startedAt === 0 ? 0 : performance.now() - startedAt,
  }
  console.log(`harness:bench stream ${JSON.stringify(payload)}`)
}

/** Called for every inbound stream event, before it reaches the reducer. */
export function onStreamEvent(event: OpencodeStreamEvent): void {
  if (!enabled) return
  if (event.type === 'text') {
    if (startedAt === 0) {
      startedAt = performance.now()
      requestAnimationFrame(frameLoop)
    }
    deltas++
    pending.push(performance.now())
    return
  }
  // One more frame so the deltas still in `pending` get a real paint stamp
  // rather than being dropped from the sample set.
  if (event.type === 'done' || event.type === 'error') {
    requestAnimationFrame(() => {
      drain()
      report()
    })
  }
}

/** Called from a layout effect once the transcript state has hit the DOM. */
export function afterCommit(): void {
  if (!enabled || rafQueued || pending.length === 0) return
  rafQueued = true
  requestAnimationFrame(drain)
}

/**
 * Drives one prompt through the real submit path on mount. Going through
 * `handleSubmit` rather than calling `opencode.send` directly is deliberate:
 * the assistant message the reducer streams into only exists because submit
 * created it, and measuring a path the product does not use would be pointless.
 */
export function autoSubmit(submit: (text: string) => boolean): void {
  if (!enabled || submitted) return
  submitted = true
  submit('bench')
}
