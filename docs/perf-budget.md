# Performance budget

Numbers the app is held to. `bun run bench --check` fails the build when a
benchmark breaks its budget or drifts more than 25% above the recorded baseline
for the same platform. CI runs it on every push (`.github/workflows/ci.yml`).

## Budgets

| Benchmark        | Metric                 | Budget | Source                    |
| ---------------- | ---------------------- | ------ | ------------------------- |
| `cold-start`     | p99 spawn→first paint  | 800 ms | `docs/PLAN.md` Phase 0    |
| `delta-to-paint` | p99 delta→frame commit | 32 ms  | `docs/PLAN.md` Phase 0    |
| `dropped-frames` | count at 200 deltas/s  | 0      | `docs/PLAN.md` Phase 0    |
| `stream-rss`     | renderer working set   | 400 MB | chosen here, ~2x measured |

`stream-rss` is the one budget not inherited from `PLAN.md`, which asks for RSS
to be reported but names no ceiling. 400 MB is roughly double the measured value
— loose enough not to flap, tight enough to catch a leak.

## What the streaming benchmarks measure

One launch drives a fixed-rate delta stream from a fake OpenCode server
(`scripts/fake-opencode.ts`) through the **real** transport: SSE decode → IPC →
React → DOM. All three streaming benchmarks read from the same launches.

`delta-to-paint` stamps `performance.now()` when a delta arrives in the renderer
and reads it back in a `requestAnimationFrame` scheduled from a layout effect —
the DOM carries the change and the browser is about to paint it. Like
`cold-start`'s use of `ready-to-show`, this is a frame-boundary proxy that
excludes the compositor's own paint time. The 32 ms budget is two frames wide
for that reason.

`dropped-frames` calibrates the display period from the median observed frame
interval rather than assuming 16.7 ms, so a 120 Hz panel does not report every
frame as a drop.

Node's timer floor means the fake server cannot always hit the requested rate.
Each run prints what it actually achieved — read that line before treating a
result as evidence for a given load.

## Baseline

`bench/baseline.json` — committed, keyed by benchmark **and** platform, because a
dev laptop and a CI runner are not comparable (CI entries are labelled
`ci-<platform>`). A platform with no entry reports `new` and does not gate — its
absolute budget is still enforced, so a first CI run publishes numbers without
failing the build. Commit a `ci-darwin` baseline from the uploaded artifact once
those numbers look stable, and drift gating starts there too.

Current (darwin, Apple silicon, 5 iterations; `cold-start` after one discarded
warm-up, streaming at 2 000 deltas/run and an achieved 178 deltas/s):

| Benchmark        | p50      | p99      | samples |
| ---------------- | -------- | -------- | ------- |
| `cold-start`     | 204 ms   | 211 ms   | 5       |
| `delta-to-paint` | 10.1 ms  | 17.1 ms  | 10 000  |
| `dropped-frames` | 0        | 0        | 5       |
| `stream-rss`     | 192.2 MB | 194.5 MB | 5       |

**Read this before optimizing the streaming path.** The transport meets its
budget today: delta→paint p99 is one frame, and a probe at an achieved
870 deltas/s — 4.4x the budget scenario — also held at 17 ms p99 with zero
dropped frames. The per-token IPC and the O(transcript) reducer pass are
real, but at the transcript lengths measured here they fit inside a frame.

The dimension these numbers do **not** cover is transcript length: every run
above streams into a two-message transcript. The argument that per-delta cost
grows with transcript size is still unmeasured, and a delta-rate knob cannot
test it. Anyone picking up the coalescing work in `docs/HARDENING.md` #2 should
add that dimension first — otherwise the optimization has no failing number to
justify it.

## Workflow

```sh
bun run build                 # bench measures the built app, not the dev server
bun run bench                 # table + bench/last-run.json (gitignored)
bun run bench --check         # exit 1 on regression or budget break
bun run bench --save          # re-record this platform's baseline
bun run bench --iterations=20 # more samples, tighter percentiles
bun run bench --filter=delta --deltas=6000 --rate=1000   # stress the transport
```

`--deltas` and `--rate` affect only the streaming benchmarks. Changing either
changes the workload, so results are comparable to the baseline only at the
defaults (2 000 deltas, 200/s).

Re-record the baseline only with an intentional change, and say why in the
commit message. A baseline bumped to make CI green is a budget deleted.
