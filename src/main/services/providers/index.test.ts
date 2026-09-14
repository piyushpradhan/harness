import { afterEach, describe, expect, it, vi } from 'vitest'

import { getCredentials, getProvider, listProviders } from './index'

const getAuth = vi.hoisted(() =>
  vi.fn<(id: string) => Promise<{ type: 'api'; key: string } | undefined>>(),
)

// The auth module reaches into Electron's `app` for the home directory, which
// does not exist outside an Electron process.
vi.mock('../auth', () => ({ getAuth }))

afterEach(() => {
  getAuth.mockReset()
  delete process.env.OPENCODE_API_KEY
})

describe('providers', () => {
  it('throws on an unknown provider id', () => {
    expect(() => getProvider('nope')).toThrow(/Unknown provider: nope/)
  })

  it('exposes only id and name to the renderer', () => {
    for (const provider of listProviders()) {
      expect(Object.keys(provider).sort()).toEqual(['id', 'name'])
    }
  })

  it('prefers a stored key over the environment', async () => {
    getAuth.mockResolvedValue({ type: 'api', key: 'stored' })
    process.env.OPENCODE_API_KEY = 'from-env'
    await expect(getCredentials('opencode')).resolves.toMatchObject({ apiKey: 'stored' })
  })

  it('falls back to the first non-empty env var', async () => {
    getAuth.mockResolvedValue(undefined)
    process.env.OPENCODE_API_KEY = 'from-env'
    await expect(getCredentials('opencode')).resolves.toEqual({
      baseUrl: 'https://opencode.ai/zen/v1',
      apiKey: 'from-env',
    })
  })

  it('returns an empty key when neither storage nor env has one', async () => {
    getAuth.mockResolvedValue(undefined)
    await expect(getCredentials('opencode-go')).resolves.toMatchObject({ apiKey: '' })
  })
})
