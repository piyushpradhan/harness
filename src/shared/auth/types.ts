/**
 * Provider identifiers for credential auto-detection, in the order they were
 * prioritized for this harness (see `PROVIDERS` in `providers.ts`).
 */
export type ProviderId = 'anthropic' | 'openai' | 'opencode' | 'xai'

/** How a detected credential authenticates: a static key or a CLI/browser login session. */
export type CredentialKind = 'api-key' | 'oauth-session'

/** Where a credential was found. Browser/CLI logins surface as `file` or `keychain`. */
export type CredentialSource = 'env' | 'file' | 'keychain'

/** One usable credential discovered on the machine. Never contains the secret itself —
 * detection answers "can we auth as X, and how", while key material stays wherever it lives. */
export interface DetectedCredential {
  provider: ProviderId
  kind: CredentialKind
  source: CredentialSource
  /** Where exactly it came from, e.g. `ANTHROPIC_API_KEY` or `~/.codex/auth.json`. */
  detail: string
}

/**
 * Everything the detector is allowed to touch. The default implementation shells out
 * to Node's env/fs (main process only); tests inject fakes here, which is what keeps
 * detection testable without a real home directory.
 */
export interface AuthIO {
  getEnv(key: string): string | undefined
  /** Expands a leading `~` (or lone `~`) to the user's home directory; other paths pass through. */
  expandHome(path: string): string
  fileExists(path: string): boolean
  readFile(path: string): string
}
