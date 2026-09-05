import type { ProviderId } from './types'

/** Declarative description of a provider the harness can authenticate against. */
export interface ProviderSpec {
  id: ProviderId
  displayName: string
  /** Lower wins. Both result order and selection priority follow this field. */
  priority: number
  /** Env var names checked in order for an API key. */
  envKeys: readonly string[]
  /** `~`-prefixed file candidates that may hold an API key or an OAuth session. */
  credentialPaths: readonly string[]
  /** macOS Keychain service name for CLI-login credentials, when applicable. */
  keychainService?: string
}

/**
 * The prioritized set of providers the harness auto-detects credentials for.
 *
 * Order matters: it is also the order credentials appear in detection results, and the
 * order fallback resolution walks. Listed first wins ties.
 *
 * Path/env values are best-effort; anything marked TODO is where the implementer
 * needs to verify against current docs or local installs.
 */
export const PROVIDERS: readonly ProviderSpec[] = [
  {
    id: 'anthropic',
    displayName: 'Anthropic',
    priority: 1,
    envKeys: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
    credentialPaths: ['~/.claude/.credentials.json'],
    keychainService: 'Claude Code-credentials',
  },
  {
    id: 'openai',
    displayName: 'OpenAI',
    priority: 2,
    envKeys: ['OPENAI_API_KEY'],
    credentialPaths: ['~/.codex/auth.json'],
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    priority: 3,
    envKeys: [], // TODO: confirm whether the OpenCode CLI honors any env var
    credentialPaths: ['~/.local/share/opencode/auth.json'],
  },
  {
    id: 'xai',
    displayName: 'xAI',
    priority: 4,
    envKeys: ['XAI_API_KEY'],
    credentialPaths: [], // TODO: xAI has no known CLI credential file at the moment
  },
]
