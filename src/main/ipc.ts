import { ipcMain, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { IPC, type ChatStartResult } from '../shared/ipc'
import type { SessionEvent } from '../shared/types'
import { deleteProfile, getProfileById, listProfiles, saveProfile } from './profiles'
import { runAgent } from './services/agent/runner'
import { createProvider } from './services/llm/registry'
import { assertChatStartRequest, assertId, assertProfileInput } from './validate'

interface ActiveSession {
  controller: AbortController
  sender: WebContents
}

const sessions = new Map<string, ActiveSession>()

export function registerIpc(): void {
  ipcMain.handle(IPC.ProfilesList, async () => ({ profiles: await listProfiles() }))

  ipcMain.handle(IPC.ProfilesSave, async (_event, input: unknown) => {
    const profile = assertProfileInput(input)
    return { profile: await saveProfile(profile) }
  })

  ipcMain.handle(IPC.ProfilesDelete, async (_event, id: unknown) => {
    await deleteProfile(assertId(id, 'id'))
    return { ok: true }
  })

  ipcMain.handle(IPC.ModelsList, async (_event, profileId: unknown) => {
    const id = assertId(profileId, 'profileId')
    const profile = await getProfileById(id)
    if (!profile) throw new Error(`no profile with id: ${id}`)
    return createProvider(profile).listModels()
  })

  ipcMain.handle(IPC.ChatStart, async (event, req: unknown): Promise<ChatStartResult> => {
    const validated = assertChatStartRequest(req)
    const profile = await getProfileById(validated.profileId)
    if (!profile) throw new Error(`no profile with id: ${validated.profileId}`)

    const sessionId = randomUUID()
    const controller = new AbortController()
    const sender = event.sender
    sessions.set(sessionId, { controller, sender })

    const emit = (evt: SessionEvent): void => {
      if (!sender.isDestroyed()) sender.send(IPC.EventForward, evt)
    }

    void runAgent({
      sessionId,
      provider: createProvider(profile),
      model: validated.model,
      system: validated.system,
      messages: validated.messages,
      onEvent: emit,
      signal: controller.signal
    })
      .catch((err: unknown) => {
        emit({ sessionId, type: 'error', message: err instanceof Error ? err.message : String(err) })
      })
      .finally(() => {
        sessions.delete(sessionId)
      })

    return { sessionId }
  })

  ipcMain.handle(IPC.ChatCancel, async (_event, sessionId: unknown) => {
    const id = assertId(sessionId, 'sessionId')
    sessions.get(id)?.controller.abort()
    return { ok: true }
  })
}