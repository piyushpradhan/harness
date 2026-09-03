import type { ChatMessage, ProviderType } from '../shared/types'
import type { ProfileInput } from '../shared/ipc'

const PROVIDER_TYPES: readonly ProviderType[] = ['openai-compat', 'ollama']
const MAX_ID = 128
const MAX_NAME = 80
const MAX_URL = 2048
const MAX_KEY = 4096
const MAX_MODEL = 200
const MAX_SYSTEM = 16_000
const MAX_MESSAGES = 200
const MAX_CONTENT = 64_000

export function assertId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID) {
    throw new Error(`${label} must be a non-empty string of at most ${MAX_ID} chars`)
  }
  return value
}

export function assertText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new Error(`${label} must be a non-empty string of at most ${max} chars`)
  }
  return value
}

export function assertOptionalText(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined
  return assertText(value, label, max)
}

function assertHttpUrl(value: string, label: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${label} must be a valid URL`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use http:// or https://`)
  }
  return value
}

export function assertProfileInput(input: unknown): ProfileInput {
  if (typeof input !== 'object' || input === null) throw new Error('profile must be an object')
  const p = input as Record<string, unknown>
  if (!PROVIDER_TYPES.includes(p.type as ProviderType)) {
    throw new Error(`type must be one of: ${PROVIDER_TYPES.join(', ')}`)
  }
  return {
    id: assertOptionalText(p.id, 'id', MAX_ID),
    type: p.type as ProviderType,
    name: assertText(p.name, 'name', MAX_NAME),
    baseUrl: assertHttpUrl(assertText(p.baseUrl, 'baseUrl', MAX_URL), 'baseUrl'),
    model: assertOptionalText(p.model, 'model', MAX_MODEL),
    apiKey: assertOptionalText(p.apiKey, 'apiKey', MAX_KEY)
  }
}

export interface ValidatedChatStartRequest {
  profileId: string
  model: string
  system?: string
  messages: ChatMessage[]
}

export function assertChatStartRequest(req: unknown): ValidatedChatStartRequest {
  if (typeof req !== 'object' || req === null) throw new Error('chat.start payload must be an object')
  const r = req as Record<string, unknown>
  const profileId = assertId(r.profileId, 'profileId')
  const model = assertText(r.model, 'model', MAX_MODEL)
  const system = assertOptionalText(r.system, 'system', MAX_SYSTEM)
  if (!Array.isArray(r.messages) || r.messages.length === 0 || r.messages.length > MAX_MESSAGES) {
    throw new Error(`messages must be an array of 1..${MAX_MESSAGES} messages`)
  }
  const messages = r.messages.map((m, i) => {
    if (typeof m !== 'object' || m === null) throw new Error(`messages[${i}] must be an object`)
    const mm = m as Record<string, unknown>
    if (mm.role !== 'system' && mm.role !== 'user' && mm.role !== 'assistant') {
      throw new Error(`messages[${i}].role must be system, user or assistant`)
    }
    if (typeof mm.content !== 'string' || mm.content.length === 0 || mm.content.length > MAX_CONTENT) {
      throw new Error(`messages[${i}].content must be a non-empty string of at most ${MAX_CONTENT} chars`)
    }
    return { role: mm.role, content: mm.content } as ChatMessage
  })
  return { profileId, model, system, messages }
}