import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createLogger, getLogLevel, setLogLevel } from './logger'

const spies = {
  debug: vi.spyOn(console, 'debug').mockImplementation(() => undefined),
  info: vi.spyOn(console, 'info').mockImplementation(() => undefined),
  warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
  error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
}

beforeEach(() => {
  setLogLevel('debug')
})

afterEach(() => {
  vi.clearAllMocks()
  setLogLevel('info')
})

describe('logger', () => {
  it('prefixes messages with the namespace', () => {
    createLogger('auth').info('stored a key', { id: 'opencode' })
    expect(spies.info).toHaveBeenCalledWith('[auth] stored a key', { id: 'opencode' })
  })

  it('nests child namespaces', () => {
    createLogger('llm').child('opencode').warn('slow response')
    expect(spies.warn).toHaveBeenCalledWith('[llm:opencode] slow response')
  })

  it('drops messages below the current level', () => {
    setLogLevel('warn')
    const log = createLogger('bench')
    log.debug('noise')
    log.info('noise')
    log.warn('kept')
    log.error('kept')
    expect(spies.debug).not.toHaveBeenCalled()
    expect(spies.info).not.toHaveBeenCalled()
    expect(spies.warn).toHaveBeenCalledOnce()
    expect(spies.error).toHaveBeenCalledOnce()
  })

  it('silences every level at "silent"', () => {
    setLogLevel('silent')
    const log = createLogger('bench')
    log.debug('x')
    log.info('x')
    log.warn('x')
    log.error('x')
    expect(Object.values(spies).every((spy) => spy.mock.calls.length === 0)).toBe(true)
  })

  it('reports the level it is set to', () => {
    setLogLevel('error')
    expect(getLogLevel()).toBe('error')
  })
})
