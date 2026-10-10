import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer, type AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import { LineTail, isPortFree, terminate } from './process'

/** Real child processes and sockets: these primitives exist to handle the OS. */

describe('isPortFree', () => {
  it('reports a port nothing listens on as free', async () => {
    const probe = createServer().listen(0, '127.0.0.1')
    await once(probe, 'listening')
    const { port } = probe.address() as AddressInfo
    await new Promise((resolve) => probe.close(resolve))

    expect(await isPortFree(port)).toBe(true)
  })

  it('reports a port with a listener as taken', async () => {
    const holder = createServer().listen(0, '127.0.0.1')
    await once(holder, 'listening')
    const { port } = holder.address() as AddressInfo
    try {
      expect(await isPortFree(port)).toBe(false)
    } finally {
      await new Promise((resolve) => holder.close(resolve))
    }
  })
})

describe('LineTail', () => {
  it('keeps only the last N lines', () => {
    const tail = new LineTail(2)
    tail.push('one\ntwo\nthree\n')
    expect(tail.toString()).toBe('two\nthree')
  })

  it('joins a line split across chunks', () => {
    const tail = new LineTail(5)
    tail.push('Error: bad con')
    tail.push('fig\nat line 3')
    expect(tail.toString()).toBe('Error: bad config\nat line 3')
  })

  it('is empty before any output', () => {
    expect(new LineTail(5).toString()).toBe('')
  })

  it('skips blank lines', () => {
    const tail = new LineTail(5)
    tail.push('a\n\n\r\nb\n')
    expect(tail.toString()).toBe('a\nb')
  })
})

describe('terminate', () => {
  const live: ChildProcess[] = []

  afterEach(() => {
    for (const child of live) child.kill('SIGKILL')
    live.length = 0
  })

  /** A node child that has installed its handlers once it prints `ready`. */
  async function node(script: string): Promise<ChildProcess> {
    const child = spawn(process.execPath, ['-e', `${script};console.log('ready')`], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    live.push(child)
    await once(child.stdout, 'data')
    return child
  }

  it('stops a child that honors SIGTERM', async () => {
    const child = await node('setInterval(() => {}, 1000)')
    await terminate(child, 2_000)
    expect(child.signalCode).toBe('SIGTERM')
  })

  it('escalates to SIGKILL when SIGTERM is ignored', async () => {
    const child = await node("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)")
    await terminate(child, 100)
    expect(child.signalCode).toBe('SIGKILL')
  })

  it('returns at once for a child that already exited', async () => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
    await once(child, 'exit')
    const started = performance.now()
    await terminate(child, 2_000)
    expect(performance.now() - started).toBeLessThan(50)
  })
})
