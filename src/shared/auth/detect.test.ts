import { describe, expect, it } from 'vitest'

import { PROVIDERS } from './providers'
import type { AuthIO, DetectedCredential, ProviderId } from './types'

/**
 * Build a fake AuthIO from a tiny description:
 *  - `env`: env-var map; `getEnv` returns the value or undefined.
 *  - `files`: map of `~`-prefixed path -> file contents. Use `null` to simulate
 *    "exists but reading throws" (readFile will throw on those entries).
 *  - `home`: the home directory `~` expands to.
 */
function fakeIO({
  env = {},
  files = {},
  home = '/home/test',
}: {
  env?: Record<string, string>
  files?: Record<string, string | null>
  home?: string
} = {}): AuthIO {
  return {
    getEnv: (key) => env[key],
    expandHome: (path) =>
      path === '~' ? home : path.startsWith('~/') ? home + path.slice(1) : path,
    fileExists: (path) => files[path] !== undefined,
    readFile: (path) => {
      const contents = files[path]
      if (contents === null) throw new Error(`unreadable: ${path}`)
      return contents
    },
  }
}

/** Reverse-lookup a provider spec by id, asserting it exists. */
function spec(id: ProviderId) {
  const found = PROVIDERS.find((p) => p.id === id)
  if (!found) throw new Error(`test setup: unknown provider ${id}`)
  return found
}

describe('detectProviderAuth', () => {
  it('returns an empty list when nothing is configured', async () => {
    const io = fakeIO()
    const result = await import('./detect').then((m) => m.detectProviderAuth({ io }))
    expect(result).toEqual([])
  })

  it('detects an Anthropic API key from ANTHROPIC_API_KEY', async () => {
    const io = fakeIO({ env: { ANTHROPIC_API_KEY: 'sk-ant-test' } })
    const { detectProviderAuth } = await import('./detect')
    const result = await detectProviderAuth({ io })

    expect(result).toContainEqual<DetectedCredential>({
      provider: 'anthropic',
      kind: 'api-key',
      source: 'env',
      detail: 'ANTHROPIC_API_KEY',
    })
  })

  it('detects an OpenAI API key from OPENAI_API_KEY', async () => {
    const io = fakeIO({ env: { OPENAI_API_KEY: 'sk-openai-test' } })
    const { detectProviderAuth } = await import('./detect')
    const result = await detectProviderAuth({ io })

    expect(result).toContainEqual<DetectedCredential>({
      provider: 'openai',
      kind: 'api-key',
      source: 'env',
      detail: 'OPENAI_API_KEY',
    })
  })

  it('detects an xAI API key from XAI_API_KEY', async () => {
    const io = fakeIO({ env: { XAI_API_KEY: 'xai-test' } })
    const { detectProviderAuth } = await import('./detect')
    const result = await detectProviderAuth({ io })

    expect(result).toContainEqual<DetectedCredential>({
      provider: 'xai',
      kind: 'api-key',
      source: 'env',
      detail: 'XAI_API_KEY',
    })
  })

  it('orders results by provider priority regardless of detection order', async () => {
    // Seed xAI first in the env so the test would fail if the detector returned
    // in insertion order. anthropic (priority 1) must come before xai (priority 4).
    const io = fakeIO({ env: { XAI_API_KEY: 'xai', ANTHROPIC_API_KEY: 'ant' } })
    const { detectProviderAuth } = await import('./detect')
    const result = await detectProviderAuth({ io })

    const providersInOrder = result.map((c) => c.provider)
    const priorityOf = (id: ProviderId) => spec(id).priority
    const priorities = providersInOrder.map(priorityOf)
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b))
    expect(providersInOrder.indexOf('anthropic')).toBeLessThan(providersInOrder.indexOf('xai'))
  })

  it('reports at most one credential per provider', async () => {
    const io = fakeIO({
      env: { ANTHROPIC_API_KEY: 'a', ANTHROPIC_AUTH_TOKEN: 'b' },
    })
    const { detectProviderAuth } = await import('./detect')
    const result = await detectProviderAuth({ io })

    const anthropicCount = result.filter((c) => c.provider === 'anthropic').length
    expect(anthropicCount).toBe(1)
  })

  it('uses the first non-empty env key when several are configured', async () => {
    const io = fakeIO({
      env: { ANTHROPIC_API_KEY: 'a', ANTHROPIC_AUTH_TOKEN: 'b' },
    })
    const { detectProviderAuth } = await import('./detect')
    const result = await detectProviderAuth({ io })

    const anthropic = result.find((c) => c.provider === 'anthropic')
    expect(anthropic?.detail).toBe('ANTHROPIC_API_KEY')
  })

  it('prefers an env key over a credential file for the same provider', async () => {
    const io = fakeIO({
      env: { OPENAI_API_KEY: 'env-key' },
      files: { '~/.codex/auth.json': '{"OPENAI_API_KEY":"file-key","chatgpt":{"tokens":{}}}' },
    })
    const { detectProviderAuth } = await import('./detect')
    const result = await detectProviderAuth({ io })

    const openai = result.filter((c) => c.provider === 'openai')
    expect(openai).toHaveLength(1)
    expect(openai[0]?.source).toBe('env')
    expect(openai[0]?.detail).toBe('OPENAI_API_KEY')
  })

  it('detects an OAuth session from the Claude Code credentials file', async () => {
    const io = fakeIO({
      files: {
        '~/.claude/.credentials.json':
          '{"claudeAiOauth":{"accessToken":"oauth-tok","refreshToken":"r","expiresAt":123}}',
      },
    })
    const { detectProviderAuth } = await import('./detect')
    const result = await detectProviderAuth({ io })

    expect(result).toContainEqual<DetectedCredential>({
      provider: 'anthropic',
      kind: 'oauth-session',
      source: 'file',
      detail: expect.stringMatching(/\.claude\/.credentials\.json$/) as unknown as string,
    })
  })

  it('detects a ChatGPT login from the Codex auth.json file', async () => {
    const io = fakeIO({
      files: {
        '~/.codex/auth.json':
          '{"OPENAI_API_KEY":null,"chatgpt":{"tokens":{"access_token":"t","refresh_token":"r","account_id":"a"}}}',
      },
    })
    const { detectProviderAuth } = await import('./detect')
    const result = await detectProviderAuth({ io })

    expect(result).toContainEqual<DetectedCredential>({
      provider: 'openai',
      kind: 'oauth-session',
      source: 'file',
      detail: expect.stringMatching(/\.codex\/auth\.json$/) as unknown as string,
    })
  })

  it('detects an API key stored in the OpenCode auth.json file', async () => {
    const io = fakeIO({
      files: {
        '~/.local/share/opencode/auth.json': '{"anthropic":{"type":"api","key":"sk-ant-x"}}',
      },
    })
    const { detectProviderAuth } = await import('./detect')
    const result = await detectProviderAuth({ io })

    expect(result).toContainEqual<DetectedCredential>({
      provider: 'opencode',
      kind: 'api-key',
      source: 'file',
      detail: expect.stringMatching(/opencode\/auth\.json$/) as unknown as string,
    })
  })

  it('continues with other providers when one file source is unreadable', async () => {
    const io = fakeIO({
      env: { ANTHROPIC_API_KEY: 'ant' },
      files: { '~/.codex/auth.json': null },
    })
    const { detectProviderAuth } = await import('./detect')
    const result = await detectProviderAuth({ io })

    expect(result.map((c) => c.provider)).toContain('anthropic')
  })

  it('honors a restricted providers subset (others are not detected)', async () => {
    const io = fakeIO({
      env: { ANTHROPIC_API_KEY: 'ant', XAI_API_KEY: 'xai' },
    })
    const { detectProviderAuth } = await import('./detect')
    const result = await detectProviderAuth({ io, providers: [spec('xai')] })

    expect(result.map((c) => c.provider)).toEqual(['xai'])
  })

  it('re-sorts the provided providers subset by priority', async () => {
    const io = fakeIO({
      env: { ANTHROPIC_API_KEY: 'ant', XAI_API_KEY: 'xai' },
    })
    const { detectProviderAuth } = await import('./detect')
    // Pass out of order on purpose; detector must still order by priority ascending.
    const result = await detectProviderAuth({ io, providers: [spec('xai'), spec('anthropic')] })

    expect(result.map((c) => c.provider)).toEqual(['anthropic', 'xai'])
  })
})
