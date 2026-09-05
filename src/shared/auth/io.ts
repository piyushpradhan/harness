import type { AuthIO } from './types'

/**
 * Expands a leading `~` (or lone `~`) in `path` against `home`. Pass-through for
 * absolute and relative paths. Standalone so tests can pin it without touching fs.
 *
 * TODO: implement — see `io.test.ts` for the contract.
 */
export function expandHomePath(path: string, home: string): string {
  void path
  void home
  throw new Error('Not implemented yet')
}

/**
 * Builds the default {@link AuthIO} over Node's env and fs. Intended for the main
 * process only; tests inject fakes via {@link DetectAuthOptions.io}.
 *
 * TODO: implement — wire `getEnv`/`expandHome`/`fileExists`/`readFile` to node primitives.
 */
export function createNodeAuthIO(env: NodeJS.ProcessEnv = process.env): AuthIO {
  void env
  throw new Error('Not implemented yet')
}
