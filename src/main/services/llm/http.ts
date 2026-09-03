export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

/**
 * Yields lines from a fetch response body. Servers may split a single line
 * across any number of network chunks; the buffer reassembles them.
 */
export async function* iterLines(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) !== -1) {
      yield buf.slice(0, nl)
      buf = buf.slice(nl + 1)
    }
  }
  if (buf.length > 0) yield buf
}