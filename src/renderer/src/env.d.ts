/// <reference types="vite/client" />

import type { WindowChromeState } from '@shared/window-chrome'

declare global {
  interface Window {
    api: {
      platform: string
      versions: {
        electron: string
        chrome: string
        node: string
      }
      window: {
        minimize(): Promise<void>
        close(): Promise<void>
        zoom(): Promise<void>
        toggleFullScreen(): Promise<void>
        getState(): Promise<WindowChromeState>
        onState(callback: (state: WindowChromeState) => void): () => void
      }
    }
    harness: {
      providers: { list(): Promise<{ id: string; name: string }[]> }
      auth: {
        set(id: string, key: string): Promise<void>
        has(id: string): Promise<boolean>
        test(id: string): Promise<boolean>
      }
    }
  }
}

export {}
