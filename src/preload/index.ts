import { contextBridge, ipcRenderer } from 'electron'

const api = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
} as const

contextBridge.exposeInMainWorld("harness", {
  providers: { list: () => ipcRenderer.invoke("providers:list") },
    auth: {
      set:  (id: string, key: string) => ipcRenderer.invoke("auth:set", id, key),
      has:  (id: string) => ipcRenderer.invoke("auth:has", id),
      test: (id: string) => ipcRenderer.invoke("auth:test", id),
    },
});
contextBridge.exposeInMainWorld('api', api)
