/* eslint-disable @typescript-eslint/no-unused-vars -- imported for the implementer; referenced in default values below */
import { createNodeAuthIO } from './io'
import { PROVIDERS, type ProviderSpec } from './providers'
import type { AuthIO, DetectedCredential } from './types'

/**
 * Options that make detection testable without touching a real machine.
 * Every field is optional; defaults are documented on {@link detectProviderAuth}.
 */
export interface DetectAuthOptions {
  /** Defaults to {@link createNodeAuthIO}. Tests inject fakes here. */
  io?: AuthIO
  /** Defaults to {@link PROVIDERS}; ordering is by ascending `priority`. */
  providers?: readonly ProviderSpec[]
}

/**
 * Returns the credentials discoverable on this machine, one entry per provider
 * (the strongest source wins), ordered by ascending provider priority.
 *
 * **Contract** (pinned by `detect.test.ts`):
 *  - Exactly one credential per provider, or none if nothing usable is configured.
 *  - Results are sorted by `ProviderSpec.priority` ascending.
 *  - Within a provider, env keys beat credential files beat keychain entries; the
 *    first non-empty env key wins.
 *  - File/keychain failures never abort the run; other providers still get tried.
 *  - `providers` is honored as a subset filter and re-sorted by priority.
 *
 * TODO: implement — see `detect.test.ts` for the full behavior spec.
 */
export async function detectProviderAuth(
  options: DetectAuthOptions = {},
): Promise<DetectedCredential[]> {
  void options
  throw new Error('Not implemented yet')
}
