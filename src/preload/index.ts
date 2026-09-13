import { contextBridge, ipcRenderer } from 'electron'

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

contextBridge.exposeInMainWorld('harness', {
  providers: { list: () => ipcRenderer.invoke('providers:list') },
  auth: {
    set: (id: string, key: string) => ipcRenderer.invoke('auth:set', id, key),
    has: (id: string) => ipcRenderer.invoke('auth:has', id),
    test: (id: string) => ipcRenderer.invoke('auth:test', id),
  },
})
contextBridge.exposeInMainWorld('api', api)
