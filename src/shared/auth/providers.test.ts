import { describe, expect, it } from 'vitest'

import { PROVIDERS } from './providers'
import type { ProviderId } from './types'

describe('PROVIDERS registry', () => {
  it('lists anthropic, openai, opencode, and xai', () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual<ProviderId[]>([
      'anthropic',
      'openai',
      'opencode',
      'xai',
    ])
  })

  it('orders providers by ascending priority (anthropic first, xai last)', () => {
    const priorities = PROVIDERS.map((p) => p.priority)
    const sorted = [...priorities].sort((a, b) => a - b)
    expect(priorities).toEqual(sorted)
    expect(priorities[0]).toBeLessThan(priorities[priorities.length - 1] ?? Infinity)
  })

  it('assigns a unique priority to every provider', () => {
    const seen = new Set<number>()
    for (const provider of PROVIDERS) {
      expect(seen.has(provider.priority)).toBe(false)
      seen.add(provider.priority)
    }
  })

  it('assigns a unique id to every provider', () => {
    const seen = new Set<ProviderId>()
    for (const provider of PROVIDERS) {
      expect(seen.has(provider.id)).toBe(false)
      seen.add(provider.id)
    }
  })

  it('exposes at least one credential source per provider', () => {
    for (const provider of PROVIDERS) {
      const hasSource =
        provider.envKeys.length > 0 ||
        provider.credentialPaths.length > 0 ||
        provider.keychainService !== undefined
      expect(
        hasSource,
        `${provider.id} must declare at least one env key, credential path, or keychain service`,
      ).toBe(true)
    }
  })

  it('uses UPPER_SNAKE_CASE env var names', () => {
    for (const provider of PROVIDERS) {
      for (const key of provider.envKeys) {
        expect(key).toMatch(/^[A-Z][A-Z0-9_]*$/)
      }
    }
  })

  it('prefixes credential paths with "~" or returns absolute paths', () => {
    for (const provider of PROVIDERS) {
      for (const path of provider.credentialPaths) {
        const ok = path === '~' || path.startsWith('~/') || path.startsWith('/')
        expect(ok, `${provider.id}: ${path} should be "~"-prefixed or absolute`).toBe(true)
      }
    }
  })
})
