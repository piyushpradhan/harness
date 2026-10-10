import { describe, expect, it } from 'vitest'

import { attribute, packageOf } from './analyze-bundle'

describe('attribute', () => {
  it('charges each generated span to the source its mapping points at', () => {
    // Line 0: col 0 → source 0, col 3 → source 1. Line 1: col 0 → source 1.
    const sizes = attribute('abcdefg\nhij', {
      sources: ['node_modules/react/index.js', 'src/app.tsx'],
      mappings: 'AAAA,GCAA;AAAA',
    })
    expect(Object.fromEntries(sizes)).toEqual({
      'node_modules/react/index.js': 3,
      'src/app.tsx': 7,
    })
  })
})

describe('packageOf', () => {
  it('rolls dependencies up to their package, scoped or not', () => {
    expect(packageOf('../node_modules/react-dom/cjs/client.js')).toBe('react-dom')
    expect(packageOf('../node_modules/@radix-ui/react-slot/dist/index.mjs')).toBe(
      '@radix-ui/react-slot',
    )
  })

  it('leaves app sources as given', () => {
    expect(packageOf('src/renderer/src/App.tsx')).toBe('src/renderer/src/App.tsx')
  })
})
