import { promises as fs } from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

export interface AuthInfo {
  type: 'api'
  key: string
}

type AuthFile = Record<string, AuthInfo>

/** Shared with the OpenCode CLI, so a key pasted in either place works in both. */
function authFilePath(): string {
  return path.join(app.getPath('home'), '.local', 'share', 'opencode', 'auth.json')
}

async function readAll(): Promise<AuthFile> {
  try {
    return JSON.parse(await fs.readFile(authFilePath(), 'utf-8')) as AuthFile
  } catch (err) {
    // A missing file is the normal first-run state, not an error.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('auth: failed to read auth.json', err)
    }
    return {}
  }
}

/** Write-to-temp + rename, so a crash mid-write can't truncate the real file. */
async function writeAll(data: AuthFile): Promise<void> {
  const file = authFilePath()
  const tmp = `${file}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
  await fs.rename(tmp, file)
}

export async function getAuth(id: string): Promise<AuthInfo | undefined> {
  return (await readAll())[id]
}

export async function hasAuth(id: string): Promise<boolean> {
  return Boolean((await getAuth(id))?.key)
}

export async function setAuth(id: string, key: string): Promise<void> {
  const trimmed = key.trim()
  if (!trimmed) throw new Error(`auth: refusing to store an empty key for '${id}'`)
  await writeAll({ ...(await readAll()), [id]: { type: 'api', key: trimmed } })
}

export async function clearAuth(id: string): Promise<void> {
  const all = await readAll()
  if (!(id in all)) return
  delete all[id]
  await writeAll(all)
}
