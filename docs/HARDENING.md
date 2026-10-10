# Harness — Hardening Plan

Deepening what already exists. **No new features.** Every item below makes a
shipped capability faster, more correct, or more standards-compliant.

Companion to `PLAN.md` (which describes what to _build next_). This document is
the orthogonal axis: what to _finish_.

---

## Method and honesty about evidence

What was measured directly:

| Measured             | Value                    | Source                            |
| -------------------- | ------------------------ | --------------------------------- |
| Cold start p50 / p99 | 204 ms / 211 ms          | `bench/baseline.json`, darwin     |
| Renderer bundle      | 668 KB raw / 138 KB gzip | `out/renderer/assets/index-*.js`  |
| Renderer CSS         | 56 KB raw / 9 KB gzip    | `out/renderer/assets/index-*.css` |
| Main bundle          | 20 KB                    | `out/main/index.js`               |
| Test count           | 32 `it()` across 5 files | `src/**/*.test.ts`, `scripts/`    |
| Renderer tests       | 0                        | —                                 |

What was **not** measured: streaming latency, dropped frames, steady-state
renderer CPU, memory under load. There is no benchmark for any of them, which is
precisely why item **#1 is a benchmark, not an optimization**. Every perf claim
below about the streaming path is an _estimate from reading the code_, labelled
as such. The first deliverable makes those claims falsifiable.

Feature inventory as it stands: window chrome + traffic lights; chat transcript

- composer; OpenCode server lifecycle, session, SSE stream; provider registry +
  auth file; OpenAI-compatible `chat()`/`testConnection`; logger; bench rig; CI.

---

## Ranked summary

Ordered by **performance impact**, as requested. UX impact is called out
separately because the two do not correlate — #4 is the single biggest _felt_
improvement in the app and contributes almost nothing to a benchmark number.

| #   | Item                                               | Perf impact                   | UX impact           | Hackiness      | Effort |
| --- | -------------------------------------------------- | ----------------------------- | ------------------- | -------------- | ------ |
| 1   | Streaming benchmarks (enabler)                     | — (gates all below)           | —                   | Clean          | M      |
| 2   | Coalesce deltas: main batch + rAF sink             | **Very high**                 | High                | Clean          | M      |
| 3   | Keep streaming text out of React's reconciler      | **High**                      | Medium              | Amber          | M      |
| 4   | Pre-warm server + open event bus before prompt     | **High (perceived)**          | **Very high**       | Clean          | S      |
| 5   | SSE decoder + reconnect hardening                  | Low                           | High (correctness)  | Clean          | M      |
| 6   | OpenCode process supervision                       | Medium (cold start)           | High                | Clean          | M      |
| 7   | Bundle + dependency hygiene                        | Medium                        | —                   | Clean          | S      |
| 8   | Concurrent-send bug + composer state machine       | Low                           | **Very high**       | Clean          | S      |
| 9   | Native textarea auto-grow                          | Negligible                    | High                | **Very clean** | XS     |
| 10  | Theme-flash removal + `nativeTheme` sync           | Low (first paint)             | Medium              | Clean          | S      |
| 11  | Window compositing flags cleanup                   | Low–Medium                    | Low                 | Clean          | XS     |
| 12  | Electron security checklist closure                | —                             | —                   | Clean          | S      |
| 13  | LLM client correctness + timeouts + backoff        | —                             | Medium              | Clean          | S      |
| 14  | Accessibility: live region, focus, labels          | —                             | High (for AT users) | **Very clean** | S      |
| 15  | Logger: namespace filters, rank table, timestamps  | Negligible                    | Medium (DX)         | Clean          | XS     |
| 16  | Test coverage: byte-split sweep, reducer, renderer | —                             | —                   | Clean          | M      |
| 17  | Window state persistence                           | —                             | Medium              | Clean          | S      |
| 18  | Traffic-light platform mismatch                    | —                             | Medium              | Clean          | S      |
| 19  | Stale docs (`PLAN.md` / `CHECKLIST.md`)            | —                             | — (DX)              | Clean          | XS     |
| —   | Transcript virtualization                          | Deferred — see "Not worth it" |                     |                |        |
| —   | `safeStorage` for API keys                         | Deferred — see "Not worth it" |                     |                |        |

**Hackiness legend.** _Very clean_ — a native platform feature does the work.
_Clean_ — the documented, standard approach for this platform/spec. _Amber_ —
deliberately bypasses a framework's normal path; needs a comment naming the
ceiling and the upgrade path. Nothing here is _hacky_; anything that would have
been is in the "Not worth it" section instead.

---

## Tier 0 — The enabler

### 1. Streaming benchmarks

`docs/perf-budget.md` already names two budgets it cannot measure:
`delta-to-paint` p99 < 32 ms, `dropped-frames` = 0 at 200 deltas/s. Only
`cold-start` exists. Every optimization in Tier 1 is therefore currently
unfalsifiable — and "overengineering without a number" is how you ship a
regression that feels like progress.

**Current state.** `scripts/bench.ts:225` — `BENCHMARKS = [coldStart]`. The
runner, the baseline format, the platform-keyed comparison and the CI gate are
all already correct and need no changes; only the benchmark list grows.

**Build.**

- A fake SSE server (plain `node:http`, ~40 lines) that emits N `session.text.delta`
  frames at a fixed rate. No OpenCode binary needed, so it runs in CI on Linux.
- Point the OpenCode service at it via a `HARNESS_OPENCODE_URL` override rather
  than spawning — which also makes the service testable for the first time.
- Renderer-side: stamp `performance.now()` when a delta enters the sink, and read
  it back in a `requestAnimationFrame` after the DOM commit. That difference _is_
  delta→paint. Report p50/p99 through the existing `summarize()`.
- Dropped frames: count rAF callbacks whose interval exceeds 1.5× the display
  period during the run.
- RSS: `process.memoryUsage().rss` sampled from the renderer at end of run.
  `PLAN.md` Phase 0 asks for it and nothing reports it today.

**Impact.** Zero runtime. Gates items 2, 3, 4, 6, 7.

**Hackiness — clean.** Uses `performance.now()` (monotonic, `node:perf_hooks`
semantics), `requestAnimationFrame`, and the repo's own existing baseline/budget
machinery. The only design call is the local fake server, which is standard
practice (a test double at the wire boundary, not a mock inside the module).

**Verify.** Run against today's code first and **commit those numbers as the
baseline before optimizing**. Tier 1 is then measured as a delta against real,
recorded, bad numbers — not against a hope.

---

## Tier 1 — Large performance

### 2. Coalesce deltas: batch in main, flush on rAF in the renderer

**This is the single biggest performance lever in the codebase.**

**Current state.** One token = one full round trip through every layer:

- `src/main/services/opencode/index.ts:171` → `streamSink(evt)` per decoded event
- `src/main/ipc.ts:46` → `streamTarget.webContents.send('opencode:stream', evt)` —
  one structured clone, one IPC message, per token
- `src/renderer/src/components/chat/chat.tsx:53` → `setMessages(prev => prev.map(...))` —
  one React state update, one new array, one new message object, and an O(N) walk
  of the entire transcript, per token

`PLAN.md` Phase 0 names this exact pattern: _"IPC cost: the structured clone
algorithm, and why per-token IPC is the classic Electron streaming mistake."_
The code currently commits it.

At a realistic 200 deltas/s that is 200 IPC messages/s, 200 React renders/s, and
200 × N object allocations/s. The per-row `memo` in `chat-message.tsx:18` saves
the _child_ renders but not the parent's reconciliation pass, so the cost still
grows with transcript length. A 500-message transcript does 100 000 array-element
comparisons per second to append one character.

**Build.**

- **Main side.** Accumulate stream events in the service and flush on a timer
  (~8 ms, i.e. faster than a frame so the renderer is never starved) or when the
  batch exceeds a size cap. Send `OpencodeStreamEvent[]`, not one event. Text
  deltas within a batch concatenate before crossing IPC — 50 deltas become one
  string, one clone. Widen the preload/`env.d.ts` contract to the array shape;
  it is a one-line type change in `src/shared/opencode-stream.ts` consumers.
- **Renderer side.** `src/renderer/src/lib/event-sink.ts` — the rAF-coalescing
  receiver `PLAN.md` Phase 0 and `CHECKLIST.md` both already specify. Inbound
  batches queue into a plain array; a single `requestAnimationFrame` callback
  drains the queue and performs **one** `setMessages`. Cancel on unmount.
- Apply the accumulated events with one reducer pass rather than N passes:
  `applyStreamEvent` (`chat.tsx:23`) already has the right shape — fold the batch
  over it before touching state.

**Impact — very high, estimated.** IPC messages drop ~95% (200/s → ~12/s at
60 Hz with 8 ms main-side batching). React commits drop from `deltas/s` to at
most `refreshRate/s`, and become independent of token rate — the critical
property, because it means a faster model no longer means a jankier UI. Reducer
work per frame drops from O(deltas × N) to O(N).

**Hackiness — clean.** rAF coalescing is the documented React answer for
high-frequency external event sources, batching before IPC is the documented
Electron answer, and both are already written into this repo's own plan. No
dependency. ~120 lines total.

**Verify.** Item 1's benchmark, before and after. Target: `delta-to-paint` p99
under the existing 32 ms budget and zero dropped frames at 200 deltas/s, both
holding with a 1 000-message transcript loaded.

---

### 3. Keep streaming text out of React's reconciler

The natural follow-on to #2, and the point at which measurement stops being
optional.

**Current state.** Even after #2, every frame re-renders the in-flight row and
re-diffs the transcript array. At 60 Hz over a two-minute response that is 7 200
reconciliations whose only effect is appending characters to one text node.

**Build.** During streaming, write the in-flight message's text directly to a DOM
node via `ref` (`node.textContent = accumulated`) and leave React state
untouched. On `done`/`error`, commit the final string to state once and hand the
row back to React. React keeps owning everything structural — row identity,
layout, the transcript list, scroll anchoring; it stops owning the one thing
that changes 200 times a second.

`PLAN.md` Phase 8 names this ("imperative streaming sink; React only for
chrome"). It composes cleanly with `MessageScroller`, which already manages
scroll imperatively rather than through render.

**Impact — high, estimated.** React work during streaming drops to approximately
zero. Combined with #2, streaming cost becomes independent of both token rate
_and_ transcript length.

**Hackiness — amber, and the only amber item here.** This deliberately steps
outside React's render model. It is legitimate and has industry precedent
(streaming chat UIs broadly do this), but it must be fenced:

- Exactly one node is written imperatively, and only while `streaming === true`.
- State is the single source of truth the instant streaming ends. A re-render at
  any time produces identical DOM.
- A `ponytail:` comment naming the ceiling and the upgrade path, e.g.
  `// ponytail: imperative text write bypasses reconciliation for the in-flight row
only; state is authoritative on `done`. If rows ever need rich content
(markdown, tool cards), this must become an incremental renderer instead.`

**Do this only if #1's numbers say #2 alone was not enough.** If #2 puts
delta→paint comfortably under budget, #3 is complexity without a customer, and
the honest engineering call is to skip it and record why.

**Decision (f061e02): skipped.** #2 alone holds the budget. Measured on darwin
(Apple silicon, 144 Hz display, so a 6.9 ms frame period and a 10.4 ms
dropped-frame threshold), 2 000 deltas at an achieved ~164/s, 5 launches per
run, machine otherwise idle:

| Benchmark        | p50      | p99      | Budget |
| ---------------- | -------- | -------- | ------ |
| `delta-to-paint` | 11.6 ms  | 17.0 ms  | 32 ms  |
| `dropped-frames` | 0        | 0        | 0      |
| `stream-rss`     | 203.9 MB | 204.4 MB | 400 MB |

At 5x load (6 000 deltas, ~790/s achieved) p99 was 16.3 ms with 0 dropped
frames. Across 25 launches on an idle machine (20, ~164 and ~790 deltas/s),
none dropped a frame. Two earlier launches each dropped a single frame, and
both overlapped other Electron bench runs on the same machine. That is
contention noise, not the transport. The p99 is about half the budget and the
same as the pre-#2 baseline (17.1 ms), so this one frame of latency is not
React's to win back.

Two caveats should reopen this item if they ever matter. First, the
benchmark still streams into a two-message transcript, so the 1 000-message
target from #2 is unmeasured. Second, latency is stamped on renderer arrival,
so it excludes the main-side batch wait (at most 8 ms). Even adding that wait
in full, p99 stays under 32 ms. Add a transcript-length dimension to the rig
before reconsidering #3.

---

### 4. Pre-warm the OpenCode server and open the event bus before prompting

Largest _felt_ improvement in the product, smallest diff in this document.

**Two distinct problems, one fix.**

_Problem A — cold first message._ `ensureServer()` is called lazily from
`sendMessage()` (`opencode/index.ts:117`). The user's very first message pays for
the entire server boot: process spawn, then a `sleep(250)` **before** the first
health probe (`index.ts:86`), then poll until healthy. Budget is 15 s per port
across 4 ports. Realistically 1–3 s; in the failure path, up to a minute of a
silently frozen UI with nothing on screen but `…`.

_Problem B — dropped opening tokens (a real bug)._ The order in `sendMessage` is:
POST the prompt (`index.ts:120`), _then_ open `GET /api/event` (`index.ts:130`).
The agent starts generating server-side the moment the prompt is admitted. Every
delta emitted between the POST returning and the SSE connection being established
is **gone** — the global event bus does not replay. The user sees a response that
starts mid-sentence, intermittently, with no error anywhere.

**Build.**

- Call `ensureServer()` after `app.whenReady()` (`src/main/index.ts:85`), off the
  critical path — after `createWindow()`, so it cannot regress the 800 ms
  cold-start budget. Guard it so a failure logs and defers rather than throwing
  into app startup, and so `sendMessage` still awaits the same promise if the
  user types before the server is up.
- Open the event stream in `ensureSession()`, before the first prompt is ever
  POSTed. The pump is already reconnect-looping and idempotent; it just starts
  earlier.

**Impact.** Perceived first-response latency drops from seconds to the model's
own TTFT. Problem B's fix eliminates a class of silent, intermittent data loss
that would otherwise be nearly impossible to diagnose from a bug report.

**Hackiness — clean.** "Connect the event stream before triggering the work that
emits events" is the correct ordering for any pub/sub bus without replay, not a
trick. Pre-warming is standard. One caveat to state explicitly: this spawns
`opencode serve` for users who never send a message. Acceptable for a harness
whose entire purpose is chatting; if it ever isn't, move the trigger to first
composer focus — one line, same code.

**Verify.** Two tests against the item-1 fake server: assert a delta emitted
1 ms after prompt admission still reaches the renderer; assert `sendMessage`
called before the pre-warm resolves does not double-spawn.

---

## Tier 2 — Moderate performance, large correctness

### 5. SSE decoder and reconnect hardening

`SseDecoder` (`opencode/sse.ts`) is good code with three real gaps and one
missing capability. `CHECKLIST.md` Phase 1 already demands the test rig for this
and it has not been built.

**Gaps.**

1. **Line terminators.** Frames are split only on `\n\n` (`sse.ts:20`) and lines
   only on `\n` (`sse.ts:26`). WHATWG SSE §9.2.4 mandates `\r\n`, `\n`, **and**
   bare `\r`. A proxy or a differently-built server that emits CRLF produces
   zero parsed events and a silently growing buffer. Fix: normalize terminators,
   or split on the three-way boundary directly.
2. **Unbounded buffer.** A stream that never emits a frame boundary grows
   `this.buffer` without limit (`sse.ts:13`) — an OOM reachable from a
   misbehaving or hung server. Fix: cap it (1 MB is generous for this protocol)
   and throw a typed error past the cap.
3. **Stale decoder across reconnects.** `pump()` constructs the decoder once
   (`opencode/index.ts:160`) and reuses it across every reconnect iteration. A
   drop mid-frame leaves a partial payload in the buffer; the first bytes of the
   _new_ connection concatenate onto it and produce one corrupt event. Fix: new
   decoder per connection, or an explicit `reset()`.

**Missing capability — `Last-Event-ID`.** The decoder discards `id:` fields
(`sse.ts:27` keeps only `data:`). SSE's entire resumption mechanism is: track the
last `id:`, send it as the `Last-Event-ID` header on reconnect, server replays
from there. Without it, every reconnect loses whatever was in flight. Track the
id and send the header; if OpenCode ignores it the cost is one header, and if it
honors it the reconnect becomes lossless.

**Also in `pump()`:** fixed 1 s reconnect delay, no backoff, no jitter, infinite
retries (`index.ts:178`). A server that is down becomes one request per second
forever, in lockstep across restarts. Fix: exponential backoff with full jitter,
capped (1 s → 30 s), with a retry ceiling that surfaces an `error` event to the
renderer instead of looping in silence.

**Impact.** Perf: low. Correctness: high, and specifically for failure modes that
are invisible until a user reports "it sometimes drops the first line".

**Hackiness — clean.** Implements the actual published spec, and exponential
backoff with jitter is the standard distributed-systems answer.

**Verify.** The byte-offset split sweep `CHECKLIST.md` Phase 1 already specifies:
take a captured fixture stream, replay it split at _every_ byte offset, assert
identical output each time. `test.each` over `fixture.length` offsets — ~15
lines, and it is the only construction that actually proves framing correctness.
Plus: a CRLF fixture, a >1 MB-no-boundary fixture, and a mid-frame-drop
reconnect test.

---

### 6. OpenCode process supervision

`ensureServer` / `stopServer` (`opencode/index.ts:72,190`) work on the happy path
and degrade badly everywhere else.

| Problem                          | Location                      | Consequence                                                                                                                                                                      |
| -------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stdio: 'ignore'`                | `index.ts:82`                 | OpenCode's own error output is discarded. The user gets the generic `is \`opencode\` on PATH?` guess for _every_ failure — wrong version, bad config, auth failure, port in use. |
| Spawn-and-pray port selection    | `index.ts:76–96`              | Port conflicts are discovered by spawning a process and watching it die. Probe with `net.createServer().listen()` first; it is faster, quieter, and tells you _why_.             |
| `sleep(250)` before first probe  | `index.ts:86`                 | 250 ms of guaranteed latency even when the server is ready immediately. Probe first, then poll.                                                                                  |
| `proc.kill()` with no escalation | `index.ts:95`, `index.ts:193` | SIGTERM only, never awaited. A server ignoring SIGTERM survives as an orphan.                                                                                                    |
| `will-quit` is synchronous       | `src/main/index.ts:104`       | `stopServer()` cannot await anything. The app exits, the child may not.                                                                                                          |
| No child `exit` handler          | —                             | If `opencode serve` dies mid-session, `pump()` reconnect-loops forever against a dead port. The UI shows `…` indefinitely with no error, ever.                                   |

**Why orphans are also a cold-start problem.** A leaked `opencode serve` holds
port 4096. The next launch's port scan walks 4096→4099, and each occupied port
costs a spawn plus health polling before moving on. The failure compounds across
restarts, and it lands on the same first-message path item 4 just optimized.

**Build.** Capture stderr into a ring of the last ~20 lines and include it in the
thrown error. Probe ports before spawning. Poll immediately, then back off.
Escalate SIGTERM → wait → SIGKILL. Move teardown to `before-quit` with a single
`preventDefault()` + `app.quit()` re-entry so the child can actually be awaited.
Watch `child.on('exit')` and emit an `error` stream event to the renderer.

**Impact.** Perf: medium, via avoided cold-start port scans. UX: high —
turns an infinite silent spinner into a message that names the cause.

**Hackiness — clean.** Textbook process supervision; `PLAN.md` Phase 6 lists
"process supervision (spawn, health, restart, zombie reaping)" as a named
concept.

---

### 7. Bundle and dependency hygiene

Measured: **668 KB raw / 138 KB gzip** of renderer JS for a UI consisting of a
transcript, bubbles, a textarea and a button.

**Findings.**

1. **Two `cn` implementations, both bundled.** `src/renderer/src/lib/utils.ts`
   exports `cn` built on `clsx` + `tailwind-merge`; `button.tsx:3` and
   `message-scroller.tsx:8` instead import `cn` from the `cn` package. Both
   ship. Pick one — and the interesting call is that `cn` (the package) is the
   compiled-table implementation and is both smaller and faster than
   `clsx` + `tailwind-merge`, _and_ ships a `cn build` step that subsets its
   merge tables to the classes your source actually uses. Standardizing on it
   lets `clsx` and `tailwind-merge` be deleted outright.
2. **Radix imported three ways.** `radix-ui` (the meta-package) in `button.tsx:4`,
   `@radix-ui/react-slot` in three other files, plus `@radix-ui/react-scroll-area`
   and `@radix-ui/react-separator`. Tree-shaking currently rescues most of this,
   but the meta-package is a standing invitation to pull in the whole surface.
   One import style.
3. **Five unused components.** `card`, `scroll-area`, `badge`, `separator`,
   `input` have zero importers. Deleting `scroll-area` and `separator` also
   removes their two Radix dependencies from `package.json`.
4. **Runtime dependencies are in `devDependencies`.** `class-variance-authority`,
   `clsx`, `tailwind-merge`, `lucide-react` are imported by shipped renderer
   code but declared as dev-only. It works today purely because Vite bundles the
   renderer — it is still wrong, and it breaks the moment anything is packaged
   with dependency pruning. Move them.

**Impact — medium.** Parse and compile of 668 KB is a real, if modest, slice of
the 204 ms cold start. The dependency-declaration fix is correctness insurance
against a packaging bug that would otherwise surface as a cryptic runtime failure
in a signed build only.

**Hackiness — clean.** Deletion and correct manifest sections.

**Verify.** `bun run bench --check` — cold start must not regress. Add
`rollup-plugin-visualizer` behind a `--analyze` flag to make the bundle
composition inspectable rather than guessed at (including mine, above).

---

## Tier 3 — Small performance, large UX

### 8. Concurrent send corrupts the transcript

**A real bug, not a polish item.**

`chat.tsx:69–70` — every submit overwrites `assistantIdRef.current`. Send a
second message while the first is still streaming and:

- the first assistant message is stranded at `streaming: true` **forever** — it
  never receives its `done` event, so its spinner never stops;
- the _remainder_ of the first response's tokens are appended to the _second_
  message's bubble;
- `done` for response one closes out message two.

The transcript is now wrong and stays wrong. There is nothing in the UI stopping
the user from doing this: the Send button disables only on empty input
(`chat-composer.tsx:53`).

**Build.** The minimal correct fix is to route by ID rather than by "most
recent": the main process already knows which message an event belongs to, so
carry the assistant message id through `opencode:send` and back out on each
stream event, and have the reducer match on it. That fixes the corruption
outright and does not constrain the UI.

Then decide the _product_ behavior deliberately — and this is a genuine fork
worth a decision rather than a default:

- **Disable while streaming**: simplest, matches many chat UIs, needs
  `aria-busy` on the form and a clear disabled reason.
- **Queue**: send admits immediately, messages process in order.

Both are correct once routing is by ID. Neither is a new feature; today's
behavior is simply undefined.

**Impact.** Perf: none. UX: very high — it is a data-corruption bug in the
app's primary surface.

**Hackiness — clean.** Correlating an async response to its request by ID is the
baseline correct design; the current ref is the shortcut.

**Verify.** A reducer test: two overlapping streams interleaved, assert each
message accumulates only its own text and each settles `streaming: false`.

---

### 9. Native textarea auto-grow

`chat-composer.tsx:50-51` — `rows={1}` with `min-h-10 max-h-40 resize-none` and
no resize logic. A multi-line draft is composed through a one-row porthole with
an internal scrollbar.

**Build.** `field-sizing: content` in CSS on `.composer-input`. Electron 44 ships
Chromium ≫ 123, so it is supported unconditionally here. The existing
`min-h-10` / `max-h-40` become the clamp and behave exactly as intended.

```css
.composer-input {
  field-sizing: content;
}
```

**Impact.** Perf: negligible (arguably positive — the JS alternative measures the
scroll height on every keystroke, forcing synchronous layout). UX: high, and it
is the single highest UX-per-byte item in this document.

**Hackiness — very clean.** A native CSS property replacing what is conventionally
a ResizeObserver-plus-scrollHeight dance. Rung 3 of the ladder.

---

### 10. Theme-flash removal and `nativeTheme` sync

**Current state.** `main.tsx:11-17` reads `matchMedia` and toggles a `.dark`
class — but only after the React entry module has been fetched, parsed and
evaluated. Between first paint and that line, a dark-mode user sees the light
palette. The window's `vibrancy` is also set once at construction
(`src/main/index.ts:33`) and never updated when the system theme changes, so the
material and the palette can disagree until restart.

Note the trap: the usual fix — an inline script in `<head>` — is **blocked by the
CSP** (`index.html:7`, `script-src 'self'`). Weakening the CSP to fix a cosmetic
flash would be a bad trade.

**Build.** Make CSS the primary mechanism, which removes the JS from the critical
path entirely: define dark tokens under `@media (prefers-color-scheme: dark)` and
keep `.dark` only as an explicit override for a future manual toggle. Separately,
subscribe to `nativeTheme.on('updated')` in main and push the change alongside
the existing `window:state` channel so vibrancy and palette stay in step.

**Impact.** Perf: low (removes work before first paint). UX: medium — eliminates
a flash on every cold start for every dark-mode user.

**Hackiness — clean.** Uses the media query the platform provides, and Electron's
own `nativeTheme` API. Strictly less code than today.

---

### 11. Window compositing flags

`src/main/index.ts:31-36` sets `transparent`, `vibrancy` (macOS-only),
`backgroundMaterial: 'acrylic'` (Windows-only), `roundedCorners` and `hasShadow`
unconditionally on every platform.

`transparent: true` combined with `vibrancy` is a known-troublesome pairing on
macOS — it disables compositor fast paths and can cost frames during resize,
while `vibrancy` alone already produces the effect the app wants. Platform-gate
each flag to the platform that implements it, and test whether `transparent` is
needed at all now that vibrancy is doing the work.

**Impact.** Perf: low–medium and hard to predict without measuring — resize and
scroll smoothness, not throughput. Measure before and after; if there is no
difference, the flag cleanup still stands on correctness grounds.

**Hackiness — clean.** Removing flags that do nothing on the current platform.

---

## Tier 4 — No performance impact; standards and correctness

### 12. Electron security checklist closure

The scaffold gets the hard parts right — `contextIsolation: true`,
`sandbox: true`, `nodeIntegration: false`, a real CSP, keys that never cross the
bridge back. The remaining gaps are the cheap ones:

- **No `setWindowOpenHandler`.** Any `window.open` or `target="_blank"` creates
  an uncontrolled `BrowserWindow`. Deny by default; route external URLs through
  `shell.openExternal` after an allowlist check.
- **No `will-navigate` guard.** Nothing prevents the renderer navigating away
  from the app.
- **The dev CSP ships to production.** `index.html:7` allows
  `connect-src ... ws://localhost:*` for HMR — in the built app that is pure
  attack surface. Emit a tighter CSP for production builds, and add the missing
  directives: `object-src 'none'`, `base-uri 'self'`, `frame-src 'none'`,
  `form-action 'none'`.
- **No IPC sender validation.** Handlers in `ipc.ts` accept from any
  `webContents`. Validating `event.senderFrame` is the documented practice; low
  risk here given no remote content is ever loaded, but it is a checklist item
  and it is four lines.
- **`auth:set` does not validate its provider id** (`ipc.ts:34`) — an arbitrary
  renderer-supplied key is written into the auth file shared with the OpenCode
  CLI. Validate against `CATALOG`.
- **No payload cap on `opencode:send`** (`ipc.ts:49`) — `String(text)` accepts
  any length across IPC. Cap it.

**Impact.** None on perf or on any UX the user sees. These are load-bearing for
"adhering to industry standards", which was an explicit requirement — and every
one of them is straight off Electron's own published security checklist.

---

### 13. LLM client correctness

`src/main/services/llm/index.ts` is 36 lines with four issues:

1. **`testConnection` cannot work as written.** `PING_MODEL = 'models'`
   (`llm/index.ts:8`) sends `{"model": "models"}` to `/chat/completions`. That is
   not a model id; the request is expected to fail, so `/connect` reports a
   false negative for a perfectly valid key. A reachability check should be
   `GET {baseUrl}/models` with the `Authorization` header — the standard
   OpenAI-compatible probe, and it costs no tokens.
2. **No timeout.** The `fetch` at `llm/index.ts:14` has no `AbortSignal`. A hung
   provider hangs the IPC handler, and therefore that call, forever.
   `AbortSignal.timeout(n)` — the same primitive already used correctly in
   `isHealthy` (`opencode/index.ts:60`).
3. **Unguarded response shape.** `result.choices[0].message.content`
   (`llm/index.ts:24`) throws an opaque `TypeError` on any error-shaped or
   truncated JSON body. Validate and throw something diagnosable.
4. **No retry.** 429 and 5xx are terminal. Honor `Retry-After`, then exponential
   backoff with jitter — the same helper item 5 introduces.

**Impact.** UX: medium — `/connect` currently lies, which is the worst possible
behavior for a connection tester.

---

### 14. Accessibility

- **The transcript is not a live region.** A screen-reader user gets nothing at
  all while a response streams. `role="log"` + `aria-live="polite"` on the
  viewport (`chat.tsx:95`) is the ARIA APG pattern for exactly this. Interacts
  with item 3 — an imperatively-written text node still fires mutation
  notifications, but this needs verifying with a real screen reader, not assumed.
- **No `aria-busy`** on the form while a response is in flight (relates to #8).
- **Focus is never returned** to the composer after submit.
- **Decorative-only glyph labels.** The traffic-light buttons are labelled well
  (`title-bar.tsx:126,142,144`) — that part is already right.

Already correct and worth preserving: `prefers-reduced-motion`,
`prefers-reduced-transparency` and `prefers-contrast` are all handled in
`styles.css`, which is more than most apps do.

**Hackiness — very clean.** Attributes from the ARIA spec, no code.

---

### 15. Logger

`src/shared/logger.ts` is well-judged — `console` as the sink is the right lazy
call and the comment defending it is correct. Three cheap improvements:

- **Per-namespace filtering.** `HARNESS_LOG=info` is global. The industry norm
  (`DEBUG=`, `RUST_LOG=`) is per-namespace: `HARNESS_LOG=opencode:debug,*:warn`.
  With the streaming work in Tier 1, being able to turn on `opencode` at debug
  without drowning in everything else stops being a nicety.
- **Rank precomputation.** `enabled()` (`logger.ts:44`) does two `indexOf` scans
  per call. Trivially hot under debug logging; a precomputed rank map is free.
- **Timestamps.** No log line carries one. A relative-millisecond prefix makes
  the startup and streaming sequences readable as a timeline.

---

### 16. Test coverage

32 tests, all in `src/shared` / `scripts` / two services. Specific gaps:

- **No renderer tests at all.** `applyStreamEvent` (`chat.tsx:23`) is a pure
  reducer with five branches and zero tests — exactly what `docs/TDD.md` says
  must be tested. It is also where item 8's bug lives.
- **No byte-offset split sweep.** `CHECKLIST.md` Phase 1 explicitly requires it;
  `sse.test.ts` tests one hand-picked split point.
- **`mapEvent` is untested** (`opencode/index.ts:135`) because it is not
  exported. Export it; it is a pure function and the session-filtering logic is
  exactly the sort of thing that breaks silently.
- **Vitest runs a single `node` environment.** Add a second project with a DOM
  environment so renderer tests can exist.

---

### 17–19. Smaller items

**17. Window state persistence.** Size and position are not saved; every launch
is 800×600 at the OS default position. Standard desktop-app expectation.
`app.getPath('userData')` + a debounced write on `resize`/`move`, with bounds
validation against current displays so a window from a disconnected monitor does
not open off-screen.

**18. Traffic-light platform mismatch.** `TitleBar` renders the custom
`TrafficLights` **only on non-darwin** (`title-bar.tsx:176`), because macOS uses
the real native buttons. But ~150 lines of `styles.css` style those custom
buttons with macOS's exact colors (`#ff5f57`, `#febc2e`, `#28c840`) — so the code
paints macOS-style traffic lights on Windows and Linux, where they are
platform-inappropriate, and is dead on the platform they were designed for. Pick
one: platform-native controls on Windows/Linux, or own the macOS look
deliberately everywhere as a brand choice. Either is defensible; the current
accident is not.

**19. Stale docs.** `PLAN.md` and `CHECKLIST.md` reference files that no longer
exist — `src/shared/types.ts`, `src/main/services/llm/http.ts`, `provider.ts`,
`openaiCompat.ts`, `src/main/profiles.ts`, `src/main/validate.ts`,
`agent/runner.ts`, `ProfileRail.tsx`, and `App.tsx:165`. All eight verified
missing. The architecture and the reading lists are still sound; only the
file-level anchors have rotted. A pass to re-anchor them (or a "written against
commit X" note) stops the next session from chasing ghosts.

---

## Explicitly not worth it

Stating these is part of the answer. "Overengineer" is a mandate to go deep, not
to add mass — and a plan with nothing rejected is not a plan.

**Transcript virtualization** (`PLAN.md` Phase 8, `@tanstack/virtual`).
`message-scroller.tsx:74` already sets `content-visibility: auto` with
`contain-intrinsic-size` on every row — the browser already skips rendering and
layout for off-screen messages, natively, for free. Virtualization would add a
dependency, break native find-in-page and scroll anchoring, and complicate the
scroller that was just adopted. The native primitive covers it until DOM _node
count_ (not paint cost) becomes the bottleneck — thousands of messages. Revisit
when item 1's benchmark shows it, not before.

**`safeStorage` encryption for API keys** (`PLAN.md` Phase 8 calls this "the one
real security gap"). That assessment predates the current design. Keys now live
in `~/.local/share/opencode/auth.json` at mode `0600` — **OpenCode's own file
format**, deliberately shared so a key pasted in either tool works in both
(`auth/index.ts:17`). Encrypting it with Electron's `safeStorage` would make the
file unreadable to the OpenCode CLI and break that interop for a threat model
(local attacker with the user's file-read privileges) that already implies the
attacker can read the app's own keychain-decrypted memory. The correct move is to
document the decision, not to encrypt. If keys ever move to a harness-owned file,
`safeStorage` becomes right that same day.

**Structured JSON log output / a logging dependency.** The existing comment in
`logger.ts` already makes the case, and `PLAN.md` Phase 3 correctly separates
telemetry from human-readable logging. Adding both spines now duplicates the
work Phase 3 will do properly.

**A per-provider request adapter layer.** `providers/index.ts:26` already flags
this: every provider in the catalog is OpenAI-compatible, so an adapter
abstraction today would be an interface with one implementation. It becomes
right when Anthropic Messages or Ollama lands — Phase 1's job, not this
document's.

---

## Sequencing

Items are ranked above by impact; they should be _executed_ in dependency order.

**Stage 1 — make it measurable.** Item 1. Record honest baselines for
delta→paint, dropped frames and RSS against today's unoptimized code, and commit
them. Nothing in Stage 2 is defensible without this.

**Stage 2 — the streaming path.** Items 2 → 4 → 5 → 6. Item 2 first (largest,
and items 3/5/6 touch the same files). Item 3 **only if item 2's measured
numbers justify it**; if they don't, record that decision in the commit and skip
it. Item 4 is small enough to land alongside item 2 and is the one users will
actually notice.

**Stage 3 — correctness and standards.** Items 8 → 13 → 12 → 14 → 16. Item 8 is
a live data-corruption bug and jumps the queue over everything in Tier 4 despite
its low perf rank.

**Stage 4 — polish.** Items 9 → 10 → 11 → 7 → 15 → 17 → 18 → 19. All independent;
item 9 is fifteen minutes and disproportionately improves daily use, so it is
worth doing out of order the first time it annoys someone.

**Every stage gate:** `bun run typecheck && bun run lint && bun run test` green,
and `bun run bench --check` showing no regression — the repo's own existing rule.
Per `docs/perf-budget.md`: _"A baseline bumped to make CI green is a budget
deleted."_
