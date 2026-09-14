import { getAuth } from '../auth'

export interface ProviderInfo {
  id: string
  /** Human-readable label shown in the renderer. */
  name: string
  /** OpenAI-compatible base URL; `/chat/completions` is appended to it. */
  baseUrl: string
  /** Checked in order when no key is stored, first non-empty wins. */
  envVars: string[]
}

/** What the renderer is allowed to see — never includes a key. */
export type PublicProviderInfo = Pick<ProviderInfo, 'id' | 'name'>

export interface Credentials {
  baseUrl: string
  apiKey: string
}

/**
 * The provider registry. Adding a provider is one entry here — everything
 * downstream (credential resolution, `chat`, the renderer list) reads from it.
 *
 * ponytail: every provider so far is OpenAI-compatible, so there is no
 * per-provider request adapter. Add one when a provider needs a different wire
 * format (Anthropic Messages, Ollama) — that is Phase 1 in docs/PLAN.md.
 */
export const CATALOG: Record<string, ProviderInfo> = {
  opencode: {
    id: 'opencode',
    name: 'OpenCode Zen',
    baseUrl: 'https://opencode.ai/zen/v1',
    envVars: ['OPENCODE_API_KEY'],
  },
  'opencode-go': {
    id: 'opencode-go',
    name: 'OpenCode Go',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    envVars: ['OPENCODE_API_KEY'],
  },
}

export function getProvider(providerId: string): ProviderInfo {
  const provider = CATALOG[providerId]
  if (!provider) throw new Error(`Unknown provider: ${providerId}`)
  return provider
}

export function listProviders(): PublicProviderInfo[] {
  return Object.values(CATALOG).map(({ id, name }) => ({ id, name }))
}

/** Stored key wins over the environment, so a pasted key overrides a stale env var. */
export async function getCredentials(providerId: string): Promise<Credentials> {
  const provider = getProvider(providerId)
  const stored = await getAuth(providerId)
  const fromEnv = provider.envVars.map((name) => process.env[name]).find(Boolean)
  return { baseUrl: provider.baseUrl, apiKey: stored?.key ?? fromEnv ?? '' }
}
