import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createNodeAuthIO, expandHomePath } from './io'

describe('expandHomePath', () => {
  it('replaces a lone "~" with the home directory', () => {
    expect(expandHomePath('~', '/home/test')).toBe('/home/test')
  })

  it('expands a "~/" prefix to the home directory', () => {
    expect(expandHomePath('~/.claude/.credentials.json', '/home/test')).toBe(
      '/home/test/.claude/.credentials.json',
    )
  })

  it('passes absolute paths through unchanged', () => {
    expect(expandHomePath('/etc/passwd', '/home/test')).toBe('/etc/passwd')
  })

  it('passes relative paths through unchanged', () => {
    expect(expandHomePath('relative/path', '/home/test')).toBe('relative/path')
  })

  it('does not treat a mid-path "~" as a home reference', () => {
    expect(expandHomePath('/Users/foo/bar~baz', '/home/test')).toBe('/Users/foo/bar~baz')
  })
})

describe('createNodeAuthIO', () => {
  let scratchDir: string

  beforeEach(() => {
    scratchDir = mkdtempSync(join(tmpdir(), 'harness-auth-io-'))
  })

  afterEach(() => {
    rmSync(scratchDir, { recursive: true, force: true })
  })

  it('reads env values from the provided process env snapshot', () => {
    const io = createNodeAuthIO({ FOO: 'bar' })
    expect(io.getEnv('FOO')).toBe('bar')
    expect(io.getEnv('MISSING')).toBeUndefined()
  })

  it('reports fileExists=true and reads file contents from a real path', () => {
    const file = join(scratchDir, 'creds.json')
    writeFileSync(file, '{"token":"x"}', 'utf8')

    const io = createNodeAuthIO({})
    expect(io.fileExists(file)).toBe(true)
    expect(io.readFile(file)).toBe('{"token":"x"}')
  })

  it('reports fileExists=false for a path that does not exist', () => {
    const io = createNodeAuthIO({})
    expect(io.fileExists(join(scratchDir, 'missing.json'))).toBe(false)
  })

  it('expands "~" in paths through expandHome', () => {
    const io = createNodeAuthIO({})
    expect(io.expandHome('~/.claude/.credentials.json')).toMatch(/\.claude\/.credentials\.json$/)
  })
})
