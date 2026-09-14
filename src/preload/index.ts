import { contextBridge, ipcRenderer } from 'electron'

import type { OpencodeStreamEvent } from '@shared/opencode-stream'
import type { WindowChromeState } from '@shared/window-chrome'

const api = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize') as Promise<void>,
    close: () => ipcRenderer.invoke('window:close') as Promise<void>,
    zoom: () => ipcRenderer.invoke('window:zoom') as Promise<void>,
    toggleFullScreen: () => ipcRenderer.invoke('window:toggleFullScreen') as Promise<void>,
    getState: () => ipcRenderer.invoke('window:getState') as Promise<WindowChromeState>,
    onState: (callback: (state: WindowChromeState) => void) => {
      const listener = (_event: unknown, state: WindowChromeState) => {
        callback(state)
      }
      ipcRenderer.on('window:state', listener)
      return () => {
        ipcRenderer.removeListener('window:state', listener)
      }
    },
  },
} as const

const harness = {
  providers: {
    list: () => ipcRenderer.invoke('providers:list') as Promise<{ id: string; name: string }[]>,
  },
  auth: {
    set: (id: string, key: string) => ipcRenderer.invoke('auth:set', id, key) as Promise<void>,
    has: (id: string) => ipcRenderer.invoke('auth:has', id) as Promise<boolean>,
    test: (id: string) => ipcRenderer.invoke('auth:test', id) as Promise<boolean>,
  },
  opencode: {
    send: (text: string) =>
      ipcRenderer.invoke('opencode:send', text) as Promise<{ ok: boolean; error?: string }>,
    onStream: (callback: (event: OpencodeStreamEvent) => void) => {
      const listener = (_event: unknown, evt: OpencodeStreamEvent) => {
        callback(evt)
      }
      ipcRenderer.on('opencode:stream', listener)
      return () => {
        ipcRenderer.removeListener('opencode:stream', listener)
      }
    },
  },
} as const

contextBridge.exposeInMainWorld('api', api)
contextBridge.exposeInMainWorld('harness', harness)
