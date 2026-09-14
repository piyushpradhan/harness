import { getCredentials } from '../providers'

/** Cheapest model id accepted by every provider in the catalog; used for reachability checks. */
const PING_MODEL = 'models'

export async function chat(providerId: string, model: string, userText: string): Promise<string> {
  const { baseUrl, apiKey } = await getCredentials(providerId)
  if (!apiKey) throw new Error(`provider '${providerId}': no API key — paste one via /connect`)

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: userText }] }),
  })

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const result = (await res.json()) as { choices: { message: { content: string } }[] }
  return result.choices[0].message.content
}

/** Round-trips one request to prove the stored key is actually accepted. */
export async function testConnection(providerId: string): Promise<boolean> {
  try {
    await chat(providerId, PING_MODEL, 'ping')
    return true
  } catch (err) {
    console.error(`llm: connection test failed for '${providerId}'`, err)
    return false
  }
}
