import type { ChatMessage, ModelInfo, Profile, ProfileSummary, SessionEvent } from './types'

/**
 * Channel-name constants. Imported verbatim by main and preload so a typo
 * cannot silently desync the two sides of the bridge.
 */
export const IPC = {
  ProfilesList: 'profiles:list',
  ProfilesSave: 'profiles:save',
  ProfilesDelete: 'profiles:delete',
  ModelsList: 'models:list',
  ChatStart: 'chat:start',
  ChatCancel: 'chat:cancel',
  /** main -> renderer stream of SessionEvent objects */
  EventForward: 'harness:event'
} as const

/** Accepted by profiles:save — same shape as Profile, id optional on create. */
export type ProfileInput = Omit<Profile, 'id'> & { id?: string }

export interface ProfilesListResult {
  profiles: ProfileSummary[]
}

export interface ChatStartRequest {
  profileId: string
  model: string
  system?: string
  messages: ChatMessage[]
}

export interface ChatStartResult {
  sessionId: string
}

/**
 * The window.harness bridge surface exposed by src/preload/index.ts. The
 * renderer never touches ipcRenderer directly — it only ever calls these
 * methods, so the IPC contract is checked at compile time in all three layers.
 */
export interface HarnessApi {
  profiles: {
    list(): Promise<ProfilesListResult>
    save(input: ProfileInput): Promise<{ profile: ProfileSummary }>
    delete(id: string): Promise<{ ok: boolean }>
  }
  models: {
    list(profileId: string): Promise<ModelInfo[]>
  }
  chat: {
    start(req: ChatStartRequest): Promise<ChatStartResult>
    cancel(sessionId: string): Promise<{ ok: boolean }>
  }
  events: {
    onSessionEvent(callback: (evt: SessionEvent) => void): () => void
  }
}