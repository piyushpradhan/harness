# Performance budget

Numbers the app is held to. `bun run bench --check` fails the build when a
benchmark breaks its budget or drifts more than 25% above the recorded baseline
for the same platform. CI runs it on every push (`.github/workflows/ci.yml`).

## Budgets

| Benchmark    | Metric                | Budget | Source                 |
| ------------ | --------------------- | ------ | ---------------------- |
| `cold-start` | p99 spawn→first paint | 800 ms | `docs/PLAN.md` Phase 0 |

Not yet measurable — the rAF event sink and utility-process runtime they need
don't exist yet. Register them in `scripts/bench.ts` as Phase 0 lands:

| Planned          | Metric                | Budget |
| ---------------- | --------------------- | ------ |
| `delta-to-paint` | p99 latency           | 32 ms  |
| `dropped-frames` | count at 200 deltas/s | 0      |

## Baseline

`bench/baseline.json` — committed, keyed by benchmark **and** platform, because a
dev laptop and a CI runner are not comparable (CI entries are labelled
`ci-<platform>`). A platform with no entry reports `new` and does not gate — its
absolute budget is still enforced, so a first CI run publishes numbers without
failing the build. Commit a `ci-darwin` baseline from the uploaded artifact once
those numbers look stable, and drift gating starts there too.

Current (darwin, Apple silicon, 5 iterations after one discarded warm-up):

| Benchmark    | p50    | p99    |
| ------------ | ------ | ------ |
| `cold-start` | 204 ms | 211 ms |

## Workflow

```sh
bun run build                 # bench measures the built app, not the dev server
bun run bench                 # table + bench/last-run.json (gitignored)
bun run bench --check         # exit 1 on regression or budget break
bun run bench --save          # re-record this platform's baseline
bun run bench --iterations=20 # more samples, tighter percentiles
```

Re-record the baseline only with an intentional change, and say why in the
commit message. A baseline bumped to make CI green is a budget deleted.
