/**
 * Process-supervision primitives for the `opencode serve` child: probe a port
 * before spawning onto it, keep the tail of its stderr for error messages,
 * and stop it for certain.
 */
import type { ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'

/**
 * Whether nothing is listening on `port` on the loopback interface. Binding
 * and releasing a socket answers in well under a millisecond — versus
 * spawning a server, waiting for it to die, and guessing why.
 */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
  })
}

/** The last `max` non-blank lines of a stream, for error messages. */
export class LineTail {
  private lines: string[] = []
  private partial = ''

  constructor(private readonly max: number) {}

  push(chunk: string | Buffer): void {
    const parts = (this.partial + chunk.toString()).split(/\r?\n/)
    this.partial = parts.pop() ?? ''
    for (const line of parts) if (line.trim()) this.lines.push(line)
    if (this.lines.length > this.max) this.lines = this.lines.slice(-this.max)
  }

  toString(): string {
    const all = this.partial.trim() ? [...this.lines, this.partial] : this.lines
    return all.slice(-this.max).join('\n')
  }
}

export function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

/** Resolves true if `promise` settles within `ms`, false otherwise. */
async function within(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
  })
  try {
    return await Promise.race([promise.then(() => true), timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * SIGTERM, wait up to `graceMs`, then SIGKILL — a server ignoring SIGTERM
 * would otherwise survive the app as an orphan holding its port. Resolves
 * once the child is gone, or after a second grace period if even SIGKILL is
 * not acknowledged, so a caller blocking app quit cannot hang on it.
 */
export async function terminate(child: ChildProcess, graceMs: number): Promise<void> {
  // No pid: the spawn itself failed, there is nothing to signal.
  if (child.pid === undefined || hasExited(child)) return
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  child.kill('SIGTERM')
  if (await within(exited, graceMs)) return
  child.kill('SIGKILL')
  await within(exited, graceMs)
}
