# Harness — Build Checklist

Companion to `PLAN.md`. Work top-to-bottom; phases are ordered by dependency, items within a
phase by build order. Tick items as you go. Every phase has a **Gate** — paste the verify
output (bench numbers, test run) to me before moving on. Protocol docs move around; links
below were checked 2026-09-04.

---

## Phase 0 — Measurement rig and the event schema

- [x] **Tooling: ESLint + Prettier wired into `package.json`**
      Do it before writing new code — lint gates are cheapest when there's nothing to lint yet.
  - https://eslint.org/docs/latest/use/getting-started
  - https://typescript-eslint.io/getting-started
  - https://prettier.io/docs/en/

- [x] **GitHub Actions CI: `typecheck` + `test` on every push**
      One-commit scaffold + CI now = "works on my machine" never happens.
  - https://docs.github.com/en/actions/quickstart
  - https://docs.github.com/en/actions/automating-builds-and-tests/building-and-testing-nodejs
  - https://vitest.dev/guide/

- [x] **TDD boilerplate — Vitest + strict TS + the stub-based red/green loop**
      AI writes `*.test.ts` against a typed stub; you replace stub bodies until green.
      Protocol, conventions, and commands in `docs/TDD.md`; seed example at
      `src/shared/lib/percentile.{ts,test.ts}` (the p50/p99 helper `scripts/bench.ts` will need).

- [ ] **`src/shared/events.ts` — the `HarnessEvent` union**
      The schema everything downstream (UI, telemetry, persistence, backends) consumes. Read the
      existing 4-variant `SessionEvent` at `src/shared/types.ts:36` first.
  - OTel GenAI semantic conventions — for attribute _naming_ only (vocabulary, not the SDK):
    https://github.com/open-telemetry/semantic-conventions-genai (registry of attributes:
    `docs/registry/attributes/gen-ai.md`)
  - TypeScript discriminated unions + narrowing (why the closed union gives exhaustive checks):
    https://www.typescriptlang.org/docs/handbook/unions-and-intersections.html
    https://www.typescriptlang.org/docs/handbook/2/narrowing.html
  - Trace/span/parent-span causality concepts (OTel traces model):
    https://opentelemetry.io/docs/concepts/signals/traces/

- [ ] **`src/main/runtime/host.ts` — utility process fork + `MessageChannelMain` port handshake**
      The direct renderer↔utility channel that keeps per-token traffic out of main.
  - https://electronjs.org/docs/latest/api/utility-process
  - https://electronjs.org/docs/latest/api/message-channel-main
  - https://electronjs.org/docs/latest/tutorial/process-model

- [ ] **`src/renderer/src/lib/eventSink.ts` — rAF-coalescing receiver**
      Buffer deltas, flush to React state once per frame.
  - https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
  - React state batching (why rapid `setState` calls behave the way they do):
    https://react.dev/learn/queueing-a-series-of-state-updates
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/structuredClone (the copy cost you're avoiding per-token)

- [ ] **`scripts/bench.ts` — fake provider, p50/p99 delta→paint, dropped frames, RSS**
  - https://nodejs.org/api/perf_hooks.html (`performance.now()`, `PerformanceObserver` — the monotonic clock)
  - https://developer.chrome.com/docs/devtools/performance (frame profiling to cross-check your numbers)
  - https://web.dev/articles/rail (the 16 ms/frame reasoning behind the 32 ms budget)

- [ ] **`docs/perf-budget.md` + baseline run at 10 000 deltas**
      Suggested budgets: cold start < 800 ms, delta→paint p99 < 32 ms, 0 dropped frames at 200 deltas/s.
      Every later phase is judged against these numbers.

**Gate:** bench numbers recorded + baseline budgets set + typecheck/test green + CI passing.

---

## Phase 1 — Provider layer, hand-rolled

- [ ] **Study SSE framing and `iterLines` at `src/main/services/llm/http.ts:9`**
      It already solves chunk-boundary-splits-a-line correctly — that's the pattern to keep.
  - https://html.spec.whatwg.org/multipage/server-sent-events.html (§9.2 — the actual spec)
  - https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events

- [ ] **Widen `provider.ts`: `onDelta(text)` → `onPart(StreamPart)`**
      Text-only callbacks can't carry tool calls, thinking, or usage.
  - https://www.typescriptlang.org/docs/handbook/unions-and-intersections.html (same union technique)

- [ ] **`src/main/services/llm/anthropic.ts` — adapter from spec, raw `fetch`, no SDK**
      The event state machine (`message_start` → `content_block_*` → `message_delta` → `message_stop`);
      tool args arrive as partial JSON fragments — accumulate, parse only at `content_block_stop`.
  - https://platform.claude.com/docs/en/build-with-claude/streaming
  - https://platform.claude.com/docs/en/api/messages (event + delta object reference)
  - https://platform.claude.com/docs/en/api/errors (retry/backoff behavior)

- [ ] **Extend `openaiCompat.ts` — tool-call deltas + Responses API**
      Note how OpenAI fragments tool calls differently from Anthropic (indexed, per-call).
  - https://platform.openai.com/docs/api-reference/chat/streaming
  - https://platform.openai.com/docs/api-reference/responses-streaming
  - https://platform.openai.com/docs/guides/function-calling

- [ ] **`src/main/services/llm/presets.ts` — xAI / OpenRouter / Nous as openai-compat presets**
      Presets with quirk flags, not new adapters. Extend `PROVIDER_TYPES` (`src/main/validate.ts:4`)
      and the `<select>` in `ProfileRail.tsx:184`.
  - https://docs.x.ai/
  - https://openrouter.ai/docs (look for usage accounting / `usage: {include: true}`)
  - Nous Portal base URL from `PLAN.md`: `https://inference-api.nousresearch.com/v1`

- [ ] **Golden-fixture replay rig — capture real SSE to `fixtures/`, replay split at every byte offset**
      The proof that framing is byte-boundary-correct.
  - https://vitest.dev/api/ (`test.each` for the split-at-every-offset sweeps)
  - https://nodejs.org/api/buffer.html (byte-offset splitting)

- [ ] **Verify: chunk-split tests for every adapter; 30-chunk tool-call JSON still parses**
      Extend the pattern in `src/main/services/llm/openaiCompat.test.ts`.

**Gate:** all adapter tests green incl. byte-split fixtures; presets selectable in UI.

---

## Phase 2 — Your own agent loop

- [ ] **Read on the loop shape and the invariants before writing `loop.ts`**
      Every `tool_use` needs a matching `tool_result` in the next user message, in order — mismatch is a hard 400.
  - https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use
  - https://platform.openai.com/docs/guides/function-calling (compare how each side models the result message)

- [ ] **`src/main/services/agent/loop.ts` — replaces single-shot `runner.ts:21`**
      Preserve the `settled`-flag discipline (`runner.ts:38`) and the "abort never surfaces as an error" contract.
  - `PLAN.md` Phase 2 pseudocode (the `while (true)` sketch)
  - https://developer.mozilla.org/en-US/docs/Web/API/AbortController

- [ ] **`src/main/services/agent/tools/` — read, write, edit, bash, glob, grep**
      Each: JSON Schema + permission class + truncation policy.
  - https://json-schema.org/learn/getting-started-step-by-step
  - https://json-schema.org/understanding-json-schema
  - https://nodejs.org/api/child_process.html (spawn/kill, stdin/stdout, cleanup for `bash`)

- [ ] **`src/main/services/agent/permissions.ts` — allow/deny rules, path scoping, glob matching, ask-user IPC round-trip**
      The loop suspends, asks the renderer, resumes — `AbortSignal` live throughout.
  - https://git-scm.com/docs/gitignore (glob pattern semantics worth mirroring)
  - https://developer.mozilla.org/en-US/docs/Web/API/AbortController

- [ ] **Multi-turn conversation state — fixes `messages: [message]` at `App.tsx:165`**

- [ ] **Verify: `FakeProvider` scripted tests (pattern exists in `runner.test.ts`)**
      Loop terminates; `tool_result` ordering correct; permission denial aborts cleanly; cancellation
      mid-`bash` kills the child process.

**Gate:** FakeProvider suite green; a real multi-turn tool task completes in `npm run dev`.

---

## Phase 3 — Telemetry spine and dashboard

- [ ] **`src/telemetry/ring.ts` + `writer.ts` — bounded ring buffer, drop counters, batched async flush**
      Hot path never does I/O; overflow drops oldest honestly.
  - https://electronjs.org/docs/latest/api/utility-process (the flusher lives in its own utility process)
  - https://github.com/WiseLibs/better-sqlite3 (WAL-mode SQLite sink)

- [ ] **`src/telemetry/schema.ts` — row shapes mirroring `HarnessEvent`**

- [ ] **Sinks: `sqlite.ts` (always-on local) + `clickhouse.ts` (batched JSONEachRow over HTTP)**
      Both can run at once; sink choice goes in the Settings UI.
  - https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/mergetree (`ORDER BY` _is_ the index)
  - https://clickhouse.com/docs/en/interfaces/formats#jsoneachrow
  - https://hub.docker.com/r/clickhouse/clickhouse-server

- [ ] **`deploy/docker-compose.yml` + `deploy/dashboards/` — ClickHouse + Grafana, provisioned as code**
  - https://docs.docker.com/compose/
  - https://grafana.com/docs/grafana/latest/administration/provisioning

- [ ] **Optional: hand-written OTLP/HTTP-JSON exporter (~200 lines, no OTel SDK)**
  - https://opentelemetry.io/docs/specs/otlp/

- [ ] **Verify: 100k events/s synthetic load; hot-path p99 added latency < 1 ms; Phase 0 budgets hold;**
      then a real task's cost visible in Grafana within seconds.

**Gate:** perf numbers pasted + screenshot/confirm of the cost dashboard after a real run.

---

## Phase 4 — Context management and prompt caching

- [ ] **`context/counter.ts` — local token approximation vs provider `count_tokens`**
  - https://github.com/openai/tiktoken (BPE approximation reference)
  - https://github.com/openai/openai-cookbook ("How to count tokens")
  - Anthropic `count_tokens` endpoint — see the Messages API reference index: https://platform.claude.com/docs

- [ ] **`context/budget.ts` — window budgeting: headroom for output + unsized tool results**

- [ ] **`context/compact.ts` — summarize-and-replace older turns; never drop system prompt or the active tool-call pair**

- [ ] **`context/cache.ts` — automatic `cache_control` breakpoint placement**
      Breakpoint placement is everything; typically the biggest cost lever in the project.
  - https://platform.claude.com/docs/en/build-with-claude/prompt-caching
  - https://platform.openai.com/docs/guides/prompt-caching (OpenAI's implicit caching, for comparison)

- [ ] **Verify: replay one long fixture session caching off, then on — cache-read share climbs, cost drops**

**Gate:** dashboard shows the before/after delta.

---

## Phase 5 — MCP client, from scratch

- [ ] **JSON-RPC 2.0 grounding**
  - https://www.jsonrpc.org/specification

- [ ] **`src/main/services/mcp/{jsonrpc,stdio,http,client}.ts` — `initialize` handshake, capabilities, `tools/*`, `resources/*`, `prompts/*`, stdio + Streamable HTTP, reconnect**
  - https://modelcontextprotocol.io/specification (read "Basic Protocols" chapters: lifecycle, transports)
  - https://modelcontextprotocol.io/docs

- [ ] **Merge MCP tools into the Phase 2 registry — same permission gate, same telemetry**

- [ ] **Verify: two real public MCP servers; kill one mid-call, confirm clean recovery**
  - https://github.com/modelcontextprotocol/servers (reference servers to test against)

**Gate:** crash-recovery test passing against a real server.

---

## Phase 6 — Agent backends (their loop, your UI)

- [ ] **ACP first — best coverage per line (JSON-RPC over stdio)**
  - https://agentclientprotocol.com/get-started/introduction
  - https://agentclientprotocol.com/protocol/v1/transports (newline-delimited framing rules)
  - Tip: https://agentclientprotocol.com/llms.txt is a doc index for machine/human navigation

- [ ] **Codex app-server (JSON-RPC 2.0, `codex mcp-server` is deprecated)**
  - https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md (the authoritative wire doc)
  - https://openai.com/index/unlocking-the-codex-harness/ (architecture essay — worth reading first)

- [ ] **opencode (`opencode serve` → OpenAPI 3.1; generate types, hand-write the client)**
  - https://opencode.ai/docs/server

- [ ] **Claude Code — drive the CLI's streaming JSON mode directly, no SDK**
  - https://github.com/anthropics/claude-code (CLI reference; headless/JSON I/O)

- [ ] **Cross-cutting: process supervision (spawn, health, restart, zombie reaping) + lossy usage normalization (record what's missing, never zero it)**
  - https://nodejs.org/api/child_process.html

- [ ] **Verify: same prompt via ModelProvider vs AgentBackend → structurally comparable telemetry**

**Gate:** side-by-side telemetry comparison pasted.

---

## Phase 7 — Customization (config-driven)

- [ ] **`src/renderer/src/theme/tokens.css` — refactor the 394-line `styles.css` onto CSS custom properties**
  - https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties

- [ ] **`~/.harness/themes/*.json` — hot-reload + schema validate + safe fallback on malformed input**
  - https://nodejs.org/api/fs.html#fswatchfilename-options-listener
  - https://ajv.js.org/ (only if you decide a validator lib is acceptable)

- [ ] **`src/renderer/src/commands/registry.ts` — every user action = a named command with an id**
      The command palette falls out of this almost free.
  - https://code.visualstudio.com/docs/getstarted/keybindings (chords, `when` clauses, conflicts — the UX to match)

- [ ] **`~/.harness/keymap.json` + chord-aware matcher (pending-chord state machine, context scoping, conflict detection)**

- [ ] **Verify: theme edit applies without restart; chord rebind reports collisions**

**Gate:** both verify demos shown live.

---

## Phase 8 — Performance hardening and packaging

- [ ] **Transcript virtualization + imperative streaming sink (keep text out of React's reconciler)**
  - https://tanstack.com/virtual/latest

- [ ] **`safeStorage` migration — API keys are plaintext JSON today (`src/main/profiles.ts`), the one real security gap**
  - https://electronjs.org/docs/latest/api/safe-storage

- [ ] **Startup profiling: `--trace-startup`, V8 code cache, lazy `require`**
  - https://electronjs.org/docs/latest/tutorial/performance
  - https://electronjs.org/docs/latest/api/command-line-switches

- [ ] **Code signing + notarization + hardened runtime + auto-update**
  - https://electronjs.org/docs/latest/tutorial/code-signing
  - https://www.electron.build/mac
  - https://developer.apple.com/documentation/xcode/notarizing-macos-software-before-distribution
  - https://electronjs.org/docs/latest/tutorial/updates

- [ ] **Verify: re-run `scripts/bench.ts` with a 10 000-message transcript loaded — all Phase 0 budgets hold;**
      packaged `.app` launched, telemetry still flowing.

**Gate:** bench comparison table vs `docs/perf-budget.md` + packaged-app check.

---

## Decision map (we discuss each when you reach it)

| Phase | Decision                               | Deferred option                     |
| ----- | -------------------------------------- | ----------------------------------- |
| 0     | Locking the event schema day one       | —                                   |
| 0     | Both clocks + 3 IDs on every event     | monotonic clock scope (per-process) |
| 3     | SQLite vs DuckDB for the local sink    | until real write-volume numbers     |
| 3     | Grafana vs in-app dashboard            | once CH schema settles              |
| 4     | Breakpoint placement strategy          | —                                   |
| 5     | When SDKs may replace hand-rolled code | only after from-scratch works       |
| 6     | ACP-first ordering                     | coverage/effort ratio               |
| 8     | DuckDB/electron-builder trade-offs     | —                                   |

## Global verification (every phase)

- `npm run typecheck && npm test` green
- `npm run dev` + one real task against a real provider
- `scripts/bench.ts` vs `docs/perf-budget.md` — no regression
- After Phase 3: package (`npm run package:mac`), launch, confirm telemetry flows
