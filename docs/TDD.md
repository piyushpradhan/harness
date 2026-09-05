# TDD Workflow — AI writes tests, you write the implementation

Phase 0 sets up the loop so test-writing can be delegated without sacrificing the
red→green discipline you're here to learn. The rules below are the contract between
the AI (test author) and you (implementer).

## The loop

1. **AI writes a test file** — `something.test.ts` colocated next to the module it
   tests, importing only the **public API**. Tests are written against the contract in
   `CHECKLIST.md`/`PLAN.md` (or a stub's signature), never against internals.

2. **AI scaffolds the module as a typed stub** — full signatures, bodies that throw:

   ```ts
   /** Computes p50/p99 delta→paint latency. */
   export function percentile(values: readonly number[], p: number): number {
     throw new Error('Not implemented yet')
   }
   ```

   The stub is what keeps `bun run typecheck` **green while tests are red**. The
   signature _is_ the agreed contract; the test pins it down further.

3. **You implement** — replace the stub body. Run `bun run test:watch`: the test
   goes red→green as the body lands. Then `bun run typecheck && bun run lint` and
   commit the pair (test + implementation) together.

4. **Refactor freely** — tests are the safety net; implementation details stay
   opaque to them.

## Commands

| Command                           | Purpose                                    |
| --------------------------------- | ------------------------------------------ |
| `bun run test`                    | run the full suite once (CI does this)     |
| `bun run test:watch`              | rerun on every save — the TDD loop         |
| `bun run typecheck`               | `tsc --noEmit` over `src/` + `scripts/`    |
| `bun run lint` / `lint:fix`       | ESLint (flat config, Node+browser globals) |
| `bun run format` / `format:check` | Prettier (no-semi, single-quote, 100 cols) |

CI runs `typecheck` + `lint` + `test` on every push (`.github/workflows/ci.yml`).

## Conventions

- **Colocate tests**: `src/foo/bar.ts` ⇄ `src/foo/bar.test.ts`. Vitest is
  configured for `src/**/*.test.ts` and `scripts/**/*.test.ts`.
- **Explicit imports, no globals**: `import { describe, expect, it } from 'vitest'`
  (no `globals: true`), so files stay self-contained.
- **Test the contract, not the shape**: assert on behavior — inputs, outputs,
  thrown errors — never on how the module is written.
- **One behavior per `it`**, named as a sentence: `it('rejects p outside [0, 100]')`.
- **Stub signatures come from the plan first**: if CHECKLIST/PLAN names a shape
  (e.g. `onDelta(text)` → `onPart(StreamPart)`), the tests target that shape even
  before any implementation exists.
- **Edge cases are tests, not TODOs**: empty input, out-of-range arguments,
  mutation of inputs, single-element arrays — AI should enumerate these in the
  test file; that list is your implementation spec.

## Why this works

- Typecheck stays green throughout because stubs carry full signatures — CI never
  blocks on a red _type_ state, only on genuinely failing _behavior_.
- The test file is a precise, executable spec: when you've made the last `it`
  green, the feature is done as defined.
- You decide how things work inside; the AI can't lock you into its implementation
  choices because it never writes bodies.

## Examples

`src/shared/lib/percentile.ts` + `percentile.test.ts` (Phase 0 seed, complete and
green) show the pattern — nearest-rank p50/p99 for the bench rig.
