/**
 * Performance rig — run one benchmark suite, compare it to a committed baseline.
 *
 *   bun run bench              # run and print a table
 *   bun run bench --check      # ...and exit 1 on a regression (what CI runs)
 *   bun run bench --save       # ...and rewrite bench/baseline.json
 *
 * Flags: --iterations=N --tolerance=0.25 --filter=<substring> --json=<path>
 *        --deltas=N --rate=N   (streaming benchmarks only)
 *
 * Two workloads: `cold-start` launches the app and waits for first paint;
 * the streaming trio (`delta-to-paint`, `dropped-frames`, `stream-rss`) drives
 * a fixed-rate delta stream from a fake OpenCode server through the real
 * transport and reads the renderer's own measurements back over stdout.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { percentile } from '@shared/lib/percentile'

import { startFakeOpencode } from './fake-opencode'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_PATH = path.join(ROOT, 'bench', 'baseline.json')
const DEFAULT_JSON_PATH = path.join(ROOT, 'bench', 'last-run.json')
const DEFAULT_TOLERANCE = 0.25

/**
 * Baseline key. A CI runner and a dev laptop produce numbers that are not
 * comparable, so they get separate baseline entries rather than a shared one
 * that either fails constantly or is too loose to catch anything.
 */
const PLATFORM = process.env.CI ? `ci-${process.platform}` : process.platform

export interface Benchmark {
  name: string
  unit: string
  /** Absolute ceiling from docs/perf-budget.md, checked against p99. */
  budget: number
  /** One sample per iteration. Return an empty array to report the benchmark as skipped. */
  run(iterations: number): Promise<number[]>
}

export interface BenchmarkResult {
  name: string
  /** Timings are only comparable within one OS, hence part of the baseline key. */
  platform: string
  unit: string
  budget: number
  samples: number
  p50: number
  p99: number
  min: number
  max: number
}

export interface BenchmarkReport {
  commit: string
  createdAt: string
  results: BenchmarkResult[]
}

export interface Baseline {
  commit: string
  updatedAt: string
  results: BenchmarkResult[]
}

export type ComparisonStatus = 'ok' | 'regressed' | 'over-budget' | 'new'

export interface Comparison {
  name: string
  status: ComparisonStatus
  current: number
  baseline: number | null
  /** Fractional change vs baseline p50; null when there is nothing to compare to. */
  delta: number | null
  detail: string
}

export function summarize(
  name: string,
  unit: string,
  budget: number,
  samples: number[],
  platform: string = PLATFORM,
): BenchmarkResult {
  return {
    name,
    platform,
    unit,
    budget,
    samples: samples.length,
    p50: percentile(samples, 50),
    p99: percentile(samples, 99),
    min: Math.min(...samples),
    max: Math.max(...samples),
  }
}

/**
 * A benchmark regresses when its p50 drifts above the baseline p50 by more than
 * `tolerance`, or when its p99 breaks the absolute budget. p50 is the drift
 * signal (stable across noisy runners); p99 guards the tail.
 */
export function compare(
  current: readonly BenchmarkResult[],
  baseline: Baseline | null,
  tolerance = DEFAULT_TOLERANCE,
): Comparison[] {
  return current.map((result) => {
    const previous = baseline?.results.find(
      (entry) => entry.name === result.name && entry.platform === result.platform,
    )

    if (result.p99 > result.budget) {
      return {
        name: result.name,
        status: 'over-budget',
        current: result.p50,
        baseline: previous?.p50 ?? null,
        delta: previous ? result.p50 / previous.p50 - 1 : null,
        detail: `p99 ${fmt(result.p99)}${result.unit} over budget ${fmt(result.budget)}${result.unit}`,
      }
    }

    if (!previous) {
      return {
        name: result.name,
        status: 'new',
        current: result.p50,
        baseline: null,
        delta: null,
        detail: `no baseline for ${result.platform} — run with --save to record one`,
      }
    }

    const delta = result.p50 / previous.p50 - 1
    const regressed = delta > tolerance
    return {
      name: result.name,
      status: regressed ? 'regressed' : 'ok',
      current: result.p50,
      baseline: previous.p50,
      delta,
      detail: regressed
        ? `p50 ${fmt(result.p50)}${result.unit} is ${pct(delta)} above baseline ${fmt(previous.p50)}${result.unit}`
        : `p50 ${fmt(result.p50)}${result.unit} (${pct(delta)} vs baseline)`,
    }
  })
}

function fmt(value: number): string {
  return value.toFixed(1)
}

function pct(delta: number): string {
  // A baseline of 0 (the dropped-frames target) makes the ratio undefined.
  if (!Number.isFinite(delta)) return 'n/a'
  return `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`
}

/**
 * Cold start: process spawn until the window is ready to paint. The main process
 * prints `harness:bench first-paint <epoch-ms>` under HARNESS_BENCH=1 and quits,
 * so each iteration is a genuinely cold launch.
 */
const coldStart: Benchmark = {
  name: 'cold-start',
  unit: 'ms',
  budget: 800,
  async run(iterations) {
    const electron = path.join(ROOT, 'node_modules', 'electron', 'dist')
    const built = path.join(ROOT, 'out', 'main', 'index.js')
    if (!existsSync(electron) || !existsSync(built)) {
      console.warn('cold-start: skipped — run `bun install` and `bun run build` first')
      return []
    }

    const samples: number[] = []
    // One discarded warm-up: the first launch pays for OS page cache and code signing.
    for (let i = 0; i < iterations + 1; i++) {
      const sample = await launchOnce()
      if (i > 0) samples.push(sample)
    }
    return samples
  },
}

async function launchOnce(): Promise<number> {
  const { default: electronPath } = (await import('electron')) as unknown as { default: string }
  const startedAt = Date.now()

  // ELECTRON_RUN_AS_NODE turns the binary into a plain Node process, which never
  // paints. Some dev shells export it; the child must not inherit it.
  const { ELECTRON_RUN_AS_NODE: _asNode, ...env } = process.env

  return new Promise<number>((resolve, reject) => {
    const child = spawn(electronPath, [ROOT], {
      env: { ...env, HARNESS_BENCH: 'first-paint', HARNESS_LOG: 'silent' },
      stdio: ['ignore', 'pipe', 'inherit'],
    })

    let firstPaint: number | null = null
    let buffer = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('cold-start: timed out after 60s waiting for first paint'))
    }, 60_000)

    child.stdout.setEncoding('utf-8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      const match = /harness:bench first-paint (\d+)\n/.exec(buffer)
      if (match && firstPaint === null) firstPaint = Number(match[1]) - startedAt
    })

    child.on('error', reject)
    child.on('exit', () => {
      clearTimeout(timer)
      if (firstPaint === null) reject(new Error('cold-start: app exited before first paint'))
      else resolve(firstPaint)
    })
  })
}

/**
 * Streaming: one launch drives `deltas` text deltas at `rate`/s through the real
 * transport — fake server → SSE decode → IPC → React → DOM — and the renderer
 * reports per-delta latency, frame pacing and RSS back over stdout.
 *
 * All three benchmarks below read from the *same* launches, because running the
 * app three times to collect three series from one workload would only add
 * noise and minutes. `streamRuns` memoizes per iteration count.
 */
export interface StreamRun {
  latencies: number[]
  deltas: number
  droppedFrames: number
  framePeriod: number
  durationMs: number
  rssMb: number
}

const DEFAULT_DELTAS = 2_000
const DEFAULT_RATE = 200

let streamRunsCache: { key: string; runs: Promise<StreamRun[]> } | null = null

function streamRuns(iterations: number): Promise<StreamRun[]> {
  const deltas = Number(flag('deltas') ?? DEFAULT_DELTAS)
  const rate = Number(flag('rate') ?? DEFAULT_RATE)
  const key = `${iterations}/${deltas}/${rate}`
  if (streamRunsCache?.key !== key) {
    streamRunsCache = { key, runs: collectStreamRuns(iterations, deltas, rate) }
  }
  return streamRunsCache.runs
}

async function collectStreamRuns(
  iterations: number,
  deltas: number,
  rate: number,
): Promise<StreamRun[]> {
  const electron = path.join(ROOT, 'node_modules', 'electron', 'dist')
  const built = path.join(ROOT, 'out', 'main', 'index.js')
  if (!existsSync(electron) || !existsSync(built)) {
    console.warn('stream: skipped — run `bun install` and `bun run build` first')
    return []
  }

  const runs: StreamRun[] = []
  for (let i = 0; i < iterations; i++) {
    const server = await startFakeOpencode({ deltas, rate })
    try {
      runs.push(await streamOnce(server.url, deltas, rate))
    } finally {
      await server.close()
    }
  }

  // Node's timer floor means the server cannot always hit the requested rate.
  // Reporting what it actually achieved stops a run being read as evidence for
  // a load it never applied.
  const achieved = runs.map((run) => Math.round((run.deltas / run.durationMs) * 1000))
  console.log(
    `stream: ${deltas} deltas at ${rate}/s requested, ${achieved.join('/')} achieved, ` +
      `frame period ${runs[0]?.framePeriod.toFixed(1) ?? '?'}ms`,
  )
  return runs
}

async function streamOnce(serverUrl: string, deltas: number, rate: number): Promise<StreamRun> {
  const { default: electronPath } = (await import('electron')) as unknown as { default: string }
  const { ELECTRON_RUN_AS_NODE: _asNode, ...env } = process.env
  // Emission time plus a generous margin for launch and teardown.
  const timeoutMs = (deltas / rate) * 1000 + 60_000

  return new Promise<StreamRun>((resolve, reject) => {
    const child = spawn(electronPath, [ROOT], {
      env: {
        ...env,
        HARNESS_BENCH: 'stream',
        HARNESS_LOG: 'silent',
        HARNESS_OPENCODE_URL: serverUrl,
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    })

    let report: StreamRun | null = null
    let buffer = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`stream: timed out after ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)

    child.stdout.setEncoding('utf-8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      // The trailing newline is what proves the line is complete: the report is
      // tens of kilobytes and arrives split across several stdout chunks.
      const match = /harness:bench stream (.+)\n/.exec(buffer)
      if (!match || report !== null) return
      try {
        report = JSON.parse(match[1]) as StreamRun
      } catch (err) {
        child.kill('SIGKILL')
        reject(new Error(`stream: malformed report: ${String(err)}`))
      }
    })

    child.on('error', reject)
    child.on('exit', () => {
      clearTimeout(timer)
      if (report === null) reject(new Error('stream: app exited before reporting'))
      else if (report.deltas < deltas) {
        reject(new Error(`stream: received ${report.deltas} of ${deltas} deltas`))
      } else resolve(report)
    })
  })
}

const deltaToPaint: Benchmark = {
  name: 'delta-to-paint',
  unit: 'ms',
  budget: 32,
  async run(iterations) {
    return (await streamRuns(iterations)).flatMap((run) => run.latencies)
  },
}

const droppedFrames: Benchmark = {
  name: 'dropped-frames',
  unit: '',
  budget: 0,
  async run(iterations) {
    return (await streamRuns(iterations)).map((run) => run.droppedFrames)
  },
}

const streamRss: Benchmark = {
  name: 'stream-rss',
  unit: 'MB',
  budget: 400,
  async run(iterations) {
    return (await streamRuns(iterations)).map((run) => run.rssMb)
  },
}

export const BENCHMARKS: Benchmark[] = [coldStart, deltaToPaint, droppedFrames, streamRss]

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

async function readBaseline(): Promise<Baseline | null> {
  try {
    return JSON.parse(await readFile(BASELINE_PATH, 'utf-8')) as Baseline
  } catch {
    return null
  }
}

function currentCommit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf-8' }).trim()
  } catch {
    return 'unknown'
  }
}

function renderTable(comparisons: readonly Comparison[]): string {
  const icon: Record<ComparisonStatus, string> = {
    ok: 'ok',
    regressed: 'REGRESSED',
    'over-budget': 'OVER BUDGET',
    new: 'new',
  }
  const rows = comparisons.map((c) => `| ${c.name} | ${icon[c.status]} | ${c.detail} |`)
  return ['| benchmark | status | detail |', '| --- | --- | --- |', ...rows].join('\n')
}

async function main(): Promise<void> {
  const iterations = Number(flag('iterations') ?? 5)
  const tolerance = Number(flag('tolerance') ?? DEFAULT_TOLERANCE)
  const filter = flag('filter')
  const jsonPath = flag('json') ?? DEFAULT_JSON_PATH
  const check = process.argv.includes('--check')
  const save = process.argv.includes('--save')

  const selected = BENCHMARKS.filter((b) => !filter || b.name.includes(filter))
  const results: BenchmarkResult[] = []
  const skipped: string[] = []

  for (const benchmark of selected) {
    const samples = await benchmark.run(iterations)
    if (samples.length === 0) {
      skipped.push(benchmark.name)
      continue
    }
    results.push(summarize(benchmark.name, benchmark.unit, benchmark.budget, samples))
  }

  const report: BenchmarkReport = {
    commit: currentCommit(),
    createdAt: new Date().toISOString(),
    results,
  }
  await mkdir(path.dirname(jsonPath), { recursive: true })
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`)

  const comparisons = compare(results, await readBaseline(), tolerance)
  console.log(renderTable(comparisons))
  if (skipped.length > 0) console.log(`\nskipped: ${skipped.join(', ')}`)
  console.log(`\nreport: ${path.relative(ROOT, jsonPath)}`)

  if (save) {
    const previous = (await readBaseline())?.results ?? []
    const kept = previous.filter(
      (entry) => !results.some((r) => r.name === entry.name && r.platform === entry.platform),
    )
    const baseline: Baseline = {
      commit: currentCommit(),
      updatedAt: new Date().toISOString(),
      results: [...kept, ...results].sort((a, b) =>
        `${a.platform}/${a.name}`.localeCompare(`${b.platform}/${b.name}`),
      ),
    }
    await writeFile(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`)
    console.log(`baseline updated: ${path.relative(ROOT, BASELINE_PATH)}`)
  }

  if (check) {
    const failures = comparisons.filter(
      (c) => c.status === 'regressed' || c.status === 'over-budget',
    )
    if (failures.length > 0) {
      console.error(`\n${failures.length} benchmark(s) regressed`)
      process.exitCode = 1
    }
  }
}

// Importing this file (the tests do) must not run the suite.
if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  await main()
}
