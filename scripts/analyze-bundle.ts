/**
 * Bundle composition — what the renderer actually ships, by package.
 *
 *   bun run analyze
 *
 * Builds with source maps into a temp dir (never touching `out/`), then
 * attributes every byte of each emitted JS chunk to the source file its
 * mapping segment points at, rolled up by npm package. Sizes are minified
 * bytes, i.e. what V8 parses at cold start.
 *
 * ponytail: a source-map walk instead of rollup-plugin-visualizer — one
 * table on stdout answers "what is in the bundle" without a dependency or an
 * HTML report to open.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

interface SourceMap {
  sources: string[]
  mappings: string
}

/** Decode one base64-VLQ mapping segment into its fields. */
function decodeSegment(segment: string): number[] {
  const fields: number[] = []
  let value = 0
  let shift = 0
  for (const char of segment) {
    const digit = B64.indexOf(char)
    value += (digit & 31) << shift
    if (digit & 32) {
      shift += 5
      continue
    }
    fields.push(value & 1 ? -(value >>> 1) : value >>> 1)
    value = 0
    shift = 0
  }
  return fields
}

/** Bytes of generated code per source path. Unmapped spans count as `(unmapped)`. */
export function attribute(code: string, map: SourceMap): Map<string, number> {
  const sizes = new Map<string, number>()
  const lines = code.split('\n')
  let source = 0
  map.mappings.split(';').forEach((line, index) => {
    const lineLength = lines[index]?.length ?? 0
    let column = 0
    const points: [column: number, source: number][] = []
    for (const segment of line ? line.split(',') : []) {
      const fields = decodeSegment(segment)
      column += fields[0] ?? 0
      if (fields.length > 1) source += fields[1] ?? 0
      points.push([column, fields.length > 1 ? source : -1])
    }
    points.forEach(([start, src], i) => {
      const end = points[i + 1]?.[0] ?? lineLength
      const name = src >= 0 ? (map.sources[src] ?? '(unmapped)') : '(unmapped)'
      sizes.set(name, (sizes.get(name) ?? 0) + end - start)
    })
  })
  return sizes
}

/** `node_modules/@scope/pkg/...` → `@scope/pkg`; anything else is returned as given. */
export function packageOf(source: string): string {
  return /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(source)?.[1] ?? source
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`

function main(): void {
  const outDir = mkdtempSync(path.join(tmpdir(), 'harness-analyze-'))
  try {
    execFileSync(
      path.join(ROOT, 'node_modules', '.bin', 'electron-vite'),
      ['build', '--sourcemap', '--outDir', outDir, '--logLevel', 'error'],
      { cwd: ROOT, stdio: 'inherit' },
    )
    const assets = path.join(outDir, 'renderer', 'assets')
    for (const file of readdirSync(assets).filter((f) => /\.(js|css)$/.test(f))) {
      const code = readFileSync(path.join(assets, file), 'utf8')
      console.log(`\n${file}  ${kb(code.length)} raw / ${kb(gzipSync(code).length)} gzip`)
      if (!file.endsWith('.js')) continue
      const map = JSON.parse(readFileSync(path.join(assets, `${file}.map`), 'utf8')) as SourceMap
      const byPackage = new Map<string, number>()
      for (const [source, bytes] of attribute(code, map)) {
        // Map sources are relative to the chunk; make them repo-relative.
        const key = packageOf(path.relative(ROOT, path.resolve(assets, source)))
        byPackage.set(key, (byPackage.get(key) ?? 0) + bytes)
      }
      for (const [name, bytes] of [...byPackage].sort((a, b) => b[1] - a[1])) {
        console.log(`${kb(bytes).padStart(10)}  ${name}`)
      }
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
}

// Importing this file (the tests do) must not run the build.
if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  main()
}
