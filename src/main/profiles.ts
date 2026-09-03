import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Profile, ProfileSummary } from '../shared/types'
import type { ProfileInput } from '../shared/ipc'

interface SettingsFile {
  profiles: Profile[]
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export async function loadSettings(): Promise<SettingsFile> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8')
    return JSON.parse(raw) as SettingsFile
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { profiles: [] }
    throw new Error(`failed to read settings: ${(err as Error).message}`)
  }
}

async function saveSettings(settings: SettingsFile): Promise<void> {
  const file = settingsPath()
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8')
  await fs.rename(tmp, file)
}

function maskProfile(p: Profile): ProfileSummary {
  return {
    id: p.id,
    type: p.type,
    name: p.name,
    baseUrl: p.baseUrl,
    model: p.model,
    hasApiKey: Boolean(p.apiKey)
  }
}

export async function listProfiles(): Promise<ProfileSummary[]> {
  const { profiles } = await loadSettings()
  return profiles.map(maskProfile)
}

export async function getProfileById(id: string): Promise<Profile | undefined> {
  const { profiles } = await loadSettings()
  return profiles.find((p) => p.id === id)
}

/**
 * Create or update a profile. The apiKey is only (re)written when the input
 * carries a non-empty value; an empty key keeps the previously stored one,
 * so editing a profile never blanks an existing secret.
 */
export async function saveProfile(input: ProfileInput): Promise<ProfileSummary> {
  const settings = await loadSettings()
  const existing = input.id ? settings.profiles.find((p) => p.id === input.id) : undefined
  const id = input.id ?? existing?.id ?? randomUUID()
  const apiKey = input.apiKey?.trim() ? input.apiKey.trim() : existing?.apiKey

  const next: Profile = {
    id,
    type: input.type,
    name: input.name.trim(),
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ''),
    model: input.model?.trim() || undefined,
    ...(apiKey ? { apiKey } : {})
  }

  settings.profiles = existing
    ? settings.profiles.map((p) => (p.id === id ? next : p))
    : [...settings.profiles, next]
  await saveSettings(settings)
  return maskProfile(next)
}

export async function deleteProfile(id: string): Promise<void> {
  const settings = await loadSettings()
  settings.profiles = settings.profiles.filter((p) => p.id !== id)
  await saveSettings(settings)
}