import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'

interface AuthInfo {
  type: 'api'
  key: string
}

const file = () => path.join(app.getPath('home'), '.local', 'share', 'opencode', 'auth.json')

async function readAll(): Promise<Record<string, AuthInfo>> {
  try {
    return JSON.parse(await fs.readFile(file(), 'utf-8')) as Record<string, AuthInfo>
  } catch (err) {
    console.error('Failed to read auth.json file: ', err)
    return {}
  }
}

export async function writeAll(data: unknown) {
  const tmp = `${file()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
  await fs.rename(tmp, file())
}

export async function getAuth(id: string) {
  return (await readAll())[id]
}
export async function setAuth(id: string, key: string) {
  await writeAll({
    ...(await readAll()),
    [id]: {
      type: 'api',
      key,
    },
  })
}
