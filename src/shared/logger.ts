/**
 * Namespaced, level-filtered logging for main, preload and renderer.
 *
 * ponytail: `console` is the sink. It is already structured in DevTools, already
 * goes to stderr under Electron, and needs no dependency. Swap in a file or
 * transport sink here if logs ever need to outlive the process — call sites
 * won't change. Telemetry (Phase 3 in docs/PLAN.md) is a separate spine; this is
 * for humans reading a terminal.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const

export type LogLevel = (typeof LOG_LEVELS)[number]

export interface Logger {
  debug(message: string, ...details: unknown[]): void
  info(message: string, ...details: unknown[]): void
  warn(message: string, ...details: unknown[]): void
  error(message: string, ...details: unknown[]): void
  /** Sub-namespace: `createLogger('llm').child('opencode')` logs as `llm:opencode`. */
  child(namespace: string): Logger
}

const DEFAULT_LEVEL: LogLevel = 'info'

function isLogLevel(value: unknown): value is LogLevel {
  return LOG_LEVELS.includes(value as LogLevel)
}

// Renderer runs sandboxed with no `process`, hence the guarded read.
const fromEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env?.HARNESS_LOG

let currentLevel: LogLevel = isLogLevel(fromEnv) ? fromEnv : DEFAULT_LEVEL

export function setLogLevel(level: LogLevel): void {
  currentLevel = level
}

export function getLogLevel(): LogLevel {
  return currentLevel
}

function enabled(level: Exclude<LogLevel, 'silent'>): boolean {
  return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(currentLevel)
}

export function createLogger(namespace: string): Logger {
  const emit = (
    level: Exclude<LogLevel, 'silent'>,
    write: (...args: unknown[]) => void,
    message: string,
    details: unknown[],
  ): void => {
    if (!enabled(level)) return
    write(`[${namespace}] ${message}`, ...details)
  }

  return {
    debug: (message, ...details) => emit('debug', console.debug, message, details),
    info: (message, ...details) => emit('info', console.info, message, details),
    warn: (message, ...details) => emit('warn', console.warn, message, details),
    error: (message, ...details) => emit('error', console.error, message, details),
    child: (child) => createLogger(`${namespace}:${child}`),
  }
}
