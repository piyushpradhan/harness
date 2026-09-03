# Harness

Harness is a small Electron desktop shell for talking to LLM providers of any shape — OpenAI-compatible REST endpoints, a local Ollama daemon, or anything a ~60-line adapter can reach. Profiles store per-provider settings, the main process validates every request and routes it through a common streaming interface, and the renderer is a dependency-light React UI for picking a profile and model, sending messages, watching responses stream in, and cancelling mid-flight. The sandboxed renderer never touches `ipcRenderer`: everything crosses the bridge through a single typed `window.harness` surface, so every IPC channel, payload, and event is checked at compile time across all three layers.

```
┌────────────────────────────────────────────────────────────────┐
│ renderer — React SPA (src/renderer)                            │
│   window.harness.profiles / .models / .chat / .events          │
└──────────────────▲─────────────────────────────────────────────┘
                   │ contextBridge — src/preload/index.ts        │
┌──────────────────┴─────────────────────────────────────────────┐
│ main — src/main/index.ts                                       │
│   ipc.ts                 handlers + validation + sessions      │
│   profiles.ts            persistence → userData/settings.json  │
│   services/agent/runner.ts   stream loop → SessionEvents       │
└──────────────────┬─────────────────────────────────────────────┘
                   │ createProvider() — services/llm/registry.ts
          ┌────────┴────────┐
          ▼                 ▼
    openaiCompat.ts      ollama.ts
    (SSE, /v1/chat)      (NDJSON, /api/chat)
```

**Stack:** Electron 31 · electron-vite 2 · React 18 · TypeScript (strict, both tsconfigs) · Vitest. Only runtime UI dependencies are `react` and `react-dom`; the renderer enforces a strict CSP (`default-src 'self'`, with `ws://localhost:*` allowed in dev for HMR).

## Setup

```sh
npm install
npm run dev            # electron-vite dev server + Electron window (1100×750)
npm test               # vitest — runner + provider adapter suites
npm run typecheck      # tsc for main+preload, then for renderer+shared
npm run build          # electron-vite build → out/
npm run package:mac    # electron-builder → dist/ (DMG + ZIP)
```

Profiles persist in `settings.json` under Electron's `userData` directory; `settings.example.json` at the repo root documents the on-disk shape (it is gitignored — never commit real keys; the settings file lives outside the repo anyway).

## Adding a provider

A provider is exactly one adapter class implementing `LLMProvider`
(`listModels()`, `streamChat(req, cb) → Cancellable`) from
`src/main/services/llm/provider.ts`, plus one registry case:

1. `src/shared/types.ts` — extend the `ProviderType` union.
2. `src/main/validate.ts` — add the type to `PROVIDER_TYPES`.
3. `src/main/services/llm/<name>.ts` — implement `LLMProvider`. Reuse
   `joinUrl`/`iterLines` from `http.ts` for NDJSON or SSE parsing (see
   `ollama.ts` and `openaiCompat.ts`). The baseUrl is passed in from the
   profile; the constructor also receives the stored apiKey and default model.
4. `src/main/services/llm/registry.ts` — one `case` in `createProvider(profile)`.
5. `src/main/services/llm/<name>.test.ts` — fake a fetch stream and assert
   delta/done/error calls (follow `ollama.test.ts`).
6. `src/renderer/src/components/ProfileRail.tsx` — add an `<option>` to the
   type select.

Nothing else in the app — runner, IPC, renderer — knows a concrete provider.

## Adding an agent capability

Capabilities are expressed as new `SessionEvent` variants (e.g. tool calls,
thought traces):

1. `src/shared/types.ts` — extend the `SessionEvent` union with the new
   variant (`sessionId` included).
2. `src/main/services/agent/runner.ts` — emit it via `onEvent` at the right
   point in the stream loop. Keep the runner Electron-free so tests stay
   fake-provider based.
3. If the renderer must *request* something new: add a channel constant in
   `src/shared/ipc.ts`, a handler in `src/main/ipc.ts`, a method on
   `HarnessApi`, and a pass-through in `src/preload/index.ts`.
4. `src/renderer/src/App.tsx` — handle the new variant in the
   `onSessionEvent` switch and render it in `ChatPanel`.

The `SessionEvent` union and the `HarnessApi` interface are the compile-time
contracts: routing a new event without handling it (or vice versa) is a type
error, not a runtime surprise.