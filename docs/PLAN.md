# Harness — Learn-and-Build Plan

## Context

`~/projects/harness` is a clean, security-hardened Electron scaffold (~2250 lines, one commit). It streams text from two providers (`openai-compat`, `ollama`) through a provider registry into a React renderer. It has strict CSP, `contextIsolation` + `sandbox`, atomic settings writes, and API keys that never cross the context bridge back to the renderer. It is a good foundation and none of it needs to be thrown away.

What it is **not** yet: it has no agent loop (one request, one response, no tools, no multi-turn — `App.tsx:165` always sends a single message), no telemetry of any kind, no token or cost accounting (both adapters discard the `usage` field), and no customization surface.

The goal is a provider-agnostic agent harness that is (1) genuinely fast under high-rate token streaming, (2) instrumented so completely that every event, token, and dollar is queryable from a self-hostable dashboard, and (3) customizable in theme and keybinds.

**Governing constraint, from the user:** this is being built to _truly understand harnesses_. No vendor SDKs, no pre-built agent frameworks. Every wire protocol gets hand-implemented first. SDKs may be swapped in later, but only after the from-scratch version works and is understood. Each phase below therefore names the concept, the spec to read, and the thing you build to prove you understood it.

---

## Architecture target

Two adapter families behind **one** normalized event schema. That schema is the single most important design decision in the project: if it is right on day one, telemetry, the UI, and session persistence are all downstream of it for free.

```
                    ┌──────────────────────────────────┐
   renderer  ◄──────┤  HarnessEvent (one schema)        │
   (React)   MsgPort└──────────────────────────────────┘
                          ▲                    ▲
              ┌───────────┘                    └────────────┐
     ModelProvider  (you own the loop)    AgentBackend (they own it)
     anthropic · openai · xai                 acp (generic, stdio)
     openrouter · nous · ollama               codex app-server
     raw fetch + SSE, no SDK                  opencode HTTP
                          │
                     tool registry · permission gate · context manager
                          │
                    ┌─────▼──────┐
                    │ ring buffer │  (never blocks the agent)
                    └─────┬──────┘
                          │ batched flush, utility process
                 ┌────────┴────────┐
              SQLite WAL      ClickHouse HTTP
              (local sink)    (remote sink) ──► Grafana
```

**Process model.** Main process stays thin: window lifecycle, IPC brokerage, secrets. Agent execution and telemetry flushing both live in `utilityProcess` children — Node without Electron's overhead, and a crash there never takes down the window. The renderer talks to the agent runtime over a **direct `MessagePort`**, bypassing main entirely on the hot path.

---

## Phase 0 — Measurement rig and the event schema

Nothing here is a feature. This phase makes every later claim about performance falsifiable, and locks the schema everything else depends on.

**Concepts to learn**

- Electron process model: main vs renderer vs `utilityProcess.fork()`. Why blocking main janks the UI even though rendering happens elsewhere.
- `MessageChannelMain` / `MessagePortMain` — establishing a direct renderer↔utility channel so streaming never round-trips through main.
- IPC cost: the structured clone algorithm, and why per-token IPC is the classic Electron streaming mistake.
- Span/trace modelling: trace id, span id, parent span id, why events carry causality rather than just timestamps.

**Read**

- Electron docs: Process Model, `utilityProcess`, `MessageChannelMain`, Performance.
- OpenTelemetry **GenAI semantic conventions** — for attribute _naming_ only (`gen_ai.usage.input_tokens`, etc.). Adopt the vocabulary, not the SDK. Note these attributes are still marked Development-stability, so pin your own copy.

**Build**

- `src/shared/events.ts` — the `HarnessEvent` union. This replaces the 4-variant `SessionEvent` at `src/shared/types.ts:36`. Every event carries `{ traceId, spanId, parentSpanId?, seq, tsMonotonic, tsWall }` plus a discriminated payload. Variants to define now even if unemitted until later: `run.start/end`, `turn.start/end`, `model.request`, `model.delta`, `model.usage`, `tool.request/result`, `permission.ask/decide`, `context.compact`, `error`.
- `src/main/runtime/host.ts` — fork the agent runtime as a utility process; hand one end of a `MessageChannelMain` to the renderer.
- `src/renderer/src/lib/eventSink.ts` — coalescing receiver: buffer inbound deltas, flush once per `requestAnimationFrame`.
- `scripts/bench.ts` — a fake provider emitting N deltas at a fixed rate. Reports p50/p99 delta→paint latency, dropped frames, RSS.
- Tooling debt to clear while you're here: ESLint + Prettier, and a GitHub Actions CI running `typecheck` + `test` (both absent today).

**Verify** — `bench.ts` at 10 000 deltas: record the baseline numbers in `docs/perf-budget.md`. Set budgets now (suggested: cold start < 800 ms to first paint, delta→paint p99 < 32 ms, no dropped frames at 200 deltas/s). Later phases must not regress them.

---

## Phase 1 — Provider layer, hand-rolled

**The blocking problem:** `ChatStreamCallbacks.onDelta(text: string)` (`src/main/services/llm/provider.ts:11`) is text-only. It cannot express tool calls, thinking blocks, or usage. Widening it to a typed part-stream is the prerequisite for every remaining phase.

**Concepts to learn**

- The SSE wire format properly: `data:` framing, multi-line payloads, comments/keep-alives, `[DONE]` sentinels, and why a chunk boundary can split a line mid-token. (`iterLines` at `src/main/services/llm/http.ts:9` already solves this correctly — study it, it is the pattern.)
- **Anthropic Messages API streaming**: the event state machine — `message_start`, `content_block_start`, `content_block_delta` (`text_delta` vs `input_json_delta` vs `thinking_delta`), `content_block_stop`, `message_delta` (carries `stop_reason` + output usage), `message_stop`, `ping`, `error`. Tool arguments arrive as **partial JSON fragments** that you must accumulate and only parse at `content_block_stop`. This is the single most instructive streaming format to implement.
- **OpenAI**: Chat Completions deltas vs the newer Responses API. Tool calls arrive indexed and fragmented differently from Anthropic's.
- Which "providers" are really one adapter: xAI, OpenRouter, and Nous Portal (`https://inference-api.nousresearch.com/v1`) are all OpenAI-compatible. They are **presets with quirk flags**, not new adapters.
- `usage` shapes, especially cache tokens (`cache_creation_input_tokens` / `cache_read_input_tokens`) — these are the input to all cost accounting, and both current adapters throw them away.

**Read**

- Anthropic Messages API streaming reference; OpenAI Responses + Chat Completions streaming reference; OpenRouter docs (normalization + `usage: {include: true}`); WHATWG SSE spec §9.2.

**Build**

- Widen `provider.ts`: `onDelta(text)` → `onPart(part: StreamPart)` where `StreamPart` is `{text} | {thinking} | {toolCallDelta} | {usage} | {stopReason}`.
- `src/main/services/llm/anthropic.ts` — new adapter, raw `fetch`, no SDK.
- Extend `openaiCompat.ts` for tool-call deltas and Responses API.
- `src/main/services/llm/presets.ts` — xai / openrouter / nous as configured openai-compat presets. Extend `PROVIDER_TYPES` (`src/main/validate.ts:4`) and the `<select>` at `src/renderer/src/components/ProfileRail.tsx:184`.
- **Golden-fixture replay rig**: capture real SSE byte streams to `fixtures/`, replay them through adapters split at _every_ byte offset. This is how you prove framing is correct.

**Verify** — extend the existing chunk-splitting test pattern in `openaiCompat.test.ts` to every adapter. A tool call whose JSON arguments are split across 30 chunks must still parse.

**Reference for correctness, not for use:** when a provider's docs are ambiguous, read how an open-source client handles it — but implement from the spec.

---

## Phase 2 — Your own agent loop

This is the heart of "understanding harnesses". Everything here is what an SDK would otherwise hide.

**Concepts to learn**

- The loop itself: `while (true) { response = call(model, messages); if (stopReason === 'tool_use') { results = await execTools(); messages.push(assistantMsg, toolResults); continue } break }`.
- Message-ordering invariants that will bite you: every `tool_use` needs a matching `tool_result` in the _next_ user message, in order. A mismatch is a hard 400 from Anthropic.
- Parallel tool calls; partial failure; per-tool timeouts; output truncation (a 5 MB `grep` result will blow the context window).
- Tool schemas as JSON Schema; how schema quality drives call quality.
- Permission gating as an **async round-trip**: the loop must suspend, ask the renderer, and resume — with the `AbortSignal` still live throughout.
- Cancellation mid-tool-execution, and cleanup of spawned child processes.

**Build**

- `src/main/services/agent/loop.ts` — replaces the single-shot `runAgent` (`runner.ts:21`). Preserve its `settled`-flag discipline (`runner.ts:38`) and its "abort never surfaces as an error" contract; those are already right.
- `src/main/services/agent/tools/` — `read`, `write`, `edit`, `bash`, `glob`, `grep`. Each declares a JSON Schema, a permission class, and a truncation policy.
- `src/main/services/agent/permissions.ts` — allow/deny rules, path scoping, glob matching, and the ask-user IPC round-trip.
- Multi-turn conversation state — fixes the `messages: [message]` limitation at `App.tsx:165`.

**Verify** — a scripted `FakeProvider` (the pattern already exists in `runner.test.ts`) that emits tool calls. Assert: loop terminates, `tool_result` ordering is correct, permission denial cleanly aborts, cancellation mid-`bash` kills the child process.

---

## Phase 3 — Telemetry spine and the self-hosted dashboard

**Concepts to learn**

- Why the hot path must never do I/O: lock-free-ish ring buffer, batched async flush, and what to do on overflow (drop-oldest with a counter is honest; blocking the agent is not).
- ClickHouse schema design: `MergeTree`, choosing `ORDER BY` (this _is_ the index), `PARTITION BY toYYYYMM`, `LowCardinality(String)` for provider/model/tool names, materialized views for pre-aggregated rollups.
- Ingest: `INSERT ... FORMAT JSONEachRow` over HTTP is fast and needs **no collector** — a batch of a few thousand rows per request. This is why ClickHouse-direct beats an OTLP collector hop here.
- Cost modelling: a versioned pricing table, priced separately for input / output / cache-write / cache-read, with prices captured _at time of use_ so historical rows stay correct.

**Read** — ClickHouse MergeTree + JSONEachRow docs; Grafana provisioning-as-code.

**Build**

- `src/telemetry/schema.ts` — the row shapes (mirrors `HarnessEvent` from Phase 0).
- `src/telemetry/ring.ts` — bounded ring buffer with drop counters.
- `src/telemetry/writer.ts` — telemetry utility process; sinks are pluggable and **both can run at once**.
- Sinks: `sqlite.ts` (WAL, zero-config, offline, always available) and `clickhouse.ts` (batched JSONEachRow over HTTP).
- `deploy/docker-compose.yml` — ClickHouse + Grafana, one command to stand up, provisioned dashboards checked into the repo.
- `deploy/dashboards/` — tokens & cost per project / per task / per model, latency percentiles, tool-call frequency and failure rate, cache hit ratio, error taxonomy.
- Settings UI: sink selection (local only / remote only / both), so the user picks where data lives.

**Optional interop:** a hand-written OTLP/HTTP-JSON exporter is ~200 lines and worth writing for portability to Tempo/Jaeger/Langfuse. Still no `@opentelemetry/*` SDK.

**Verify** — synthetic 100 k events/s load; assert added p99 latency on the agent hot path stays under 1 ms and Phase 0 budgets hold. Then run a real task and confirm its cost appears in Grafana.

---

## Phase 4 — Context management and prompt caching

The phase with the largest real-world payoff, and the one Phase 3's dashboards let you actually measure.

**Concepts to learn**

- Token counting: local approximation (`tiktoken`-style BPE) versus provider `count_tokens` endpoints; when the divergence matters.
- Context-window budgeting: reserving headroom for output and for tool results you cannot size in advance.
- Compaction: summarize-and-replace older turns, what must never be dropped (system prompt, the active tool-call pair), and how to make it resumable.
- **Prompt caching**: Anthropic `cache_control` breakpoints, the 5-minute TTL, minimum cacheable prefix length, and why breakpoint _placement_ is everything. Typically the single biggest cost lever available.

**Build** — `context/counter.ts`, `context/budget.ts`, `context/compact.ts`, `context/cache.ts` (automatic breakpoint placement).

**Verify** — replay one long fixture session with caching off, then on. The dashboard should show the cache-read token share climbing and cost dropping. That delta is the proof.

---

## Phase 5 — MCP client, from scratch

**Concepts to learn** — JSON-RPC 2.0 (requests, notifications, batching, error objects); MCP `initialize` handshake and capability negotiation; `tools/list`, `tools/call`, `resources/*`, `prompts/*`; stdio transport (framing over a child process's pipes) versus Streamable HTTP; server lifecycle, health, and reconnect.

**Read** — the MCP specification directly. Skip `@modelcontextprotocol/sdk` until yours works.

**Build** — `src/main/services/mcp/{jsonrpc,stdio,http,client}.ts`; merge MCP-discovered tools into the Phase 2 registry so they flow through the same permission gate and the same telemetry.

**Verify** — connect to two real public MCP servers; kill one mid-call and confirm clean recovery.

---

## Phase 6 — Agent backends (their loop, your UI)

Now the inverse problem: adapting agents that own their own loop into the same `HarnessEvent` stream.

**Concepts to learn** — **ACP** (Agent Client Protocol): JSON-RPC over stdio, the generic adapter covering 25+ agents, best effort/coverage ratio. **Codex app-server**: JSON-RPC 2.0 daemon, ~88 methods, the authoritative Codex integration point since the `codex mcp-server` deprecation. **opencode**: `opencode serve` exposes an OpenAPI 3.1 spec — generate types from the spec, hand-write the client. **Claude Code**: drive the CLI's streaming JSON mode directly rather than importing the Agent SDK.

Cross-cutting: process supervision (spawn, health, restart, zombie reaping), and the lossy-normalization problem — these backends report usage inconsistently, so record what is missing rather than silently zeroing it.

**Build** — `src/main/services/backends/{acp,codex,opencode,claudecode}.ts`, each normalizing into `HarnessEvent`. ACP first; it buys the most coverage per line.

**Verify** — the same prompt run through a ModelProvider and through an AgentBackend produces structurally comparable telemetry.

---

## Phase 7 — Customization (config-driven)

**Concepts to learn** — design tokens as CSS custom properties; keybinding resolution: chord sequences, a pending-chord state machine, context-scoped `when` clauses, and conflict detection; hot-reloading config with schema validation and a safe fallback on malformed input.

**Build**

- `src/renderer/src/theme/tokens.css` — refactor the existing 394-line `styles.css` onto tokens.
- `~/.harness/themes/*.json`, hot-reloaded and schema-validated.
- `src/renderer/src/commands/registry.ts` — every user action becomes a named command with an id.
- `~/.harness/keymap.json` + a chord-aware matcher.
- A command palette, which falls out of the registry almost for free.

**Verify** — edit a theme file and see it apply without restart; rebind a chord and confirm conflict detection reports the collision.

---

## Phase 8 — Performance hardening and packaging

**Concepts to learn** — startup profiling (`--trace-startup`, V8 code cache, lazy `require`); virtualized list rendering for long transcripts; keeping streaming text out of React's reconciler entirely (imperative text sink, React only for chrome); `safeStorage` for API keys — currently plaintext JSON on disk (`src/main/profiles.ts`), which is the one real security gap in the scaffold; macOS notarization and hardened runtime, absent from the current `build` block in `package.json`.

**Build** — transcript virtualization, imperative streaming sink, `safeStorage` migration for keys, code signing + notarization, auto-update.

**Verify** — re-run `scripts/bench.ts`; all Phase 0 budgets hold with a 10 000-message transcript loaded.

---

## Sequencing notes

Phases 0→3 are the spine and should be done in order: the event schema gates telemetry, and the widened provider interface gates the agent loop. After Phase 3, ordering is flexible — Phase 4 (caching) has the best cost payoff, Phase 6 (backends) the best breadth-of-provider payoff, Phase 7 is independent of everything and can be slotted in whenever you want a break from protocol work.

Suggested checkpoint: after Phase 3 you have a genuinely useful, fully-instrumented single-provider harness. That is a good place to stop and use it for real work before continuing.

## Global verification

- `bun run typecheck && bun run test` green at every phase.
- `bun run dev`, run a real task against a real provider, confirm it appears in Grafana within seconds.
- `bun scripts/bench.ts` against `docs/perf-budget.md` — no phase regresses the budget.
- `bun run package:mac`, launch the packaged `.app`, confirm telemetry still flows.

## Open items to decide later (not blocking)

- Whether the local sink is SQLite or embedded DuckDB — DuckDB is far better at the analytical rollups, worse at high-rate single-row inserts. Deferred until Phase 3 has real write-volume numbers.
- Whether the dashboard stays Grafana or becomes an in-app view once the ClickHouse schema settles.
