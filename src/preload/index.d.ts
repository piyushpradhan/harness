import type { HarnessApi } from '../shared/ipc'

declare global {
  interface Window {
    /** Preload bridge — exact surface defined in src/shared/ipc.ts. */
    harness: HarnessApi
  }
}

export {}