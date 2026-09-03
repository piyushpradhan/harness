import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type ChatStartRequest, type HarnessApi, type ProfileInput } from '../shared/ipc'
import type { SessionEvent } from '../shared/types'

type SessionEventCallback = (evt: SessionEvent) => void

const eventCallbacks = new Set<SessionEventCallback>()

// Single main -> renderer listener; onSessionEvent subscribers are fanned out
// from it, so re-subscribing (e.g. StrictMode remounts) never stacks duplicate
// ipcRenderer listeners.
ipcRenderer.on(IPC.EventForward, (_event: IpcRendererEvent, evt: SessionEvent) => {
  for (const cb of eventCallbacks) cb(evt)
})

const api: HarnessApi = {
  profiles: {
    list: () => ipcRenderer.invoke(IPC.ProfilesList),
    save: (input: ProfileInput) => ipcRenderer.invoke(IPC.ProfilesSave, input),
    delete: (id: string) => ipcRenderer.invoke(IPC.ProfilesDelete, id)
  },
  models: {
    list: (profileId: string) => ipcRenderer.invoke(IPC.ModelsList, profileId)
  },
  chat: {
    start: (req: ChatStartRequest) => ipcRenderer.invoke(IPC.ChatStart, req),
    cancel: (sessionId: string) => ipcRenderer.invoke(IPC.ChatCancel, sessionId)
  },
  events: {
    onSessionEvent: (callback: SessionEventCallback) => {
      eventCallbacks.add(callback)
      return () => {
        eventCallbacks.delete(callback)
      }
    }
  }
}

contextBridge.exposeInMainWorld('harness', api)