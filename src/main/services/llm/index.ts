import { getCredentials } from "../providers";

export async function chat(providerID: string, model: string, userText: string): Promise<string> {
  const { baseUrl, apiKey } = await getCredentials(providerID);

  if (!apiKey) throw new Error(`provider '${providerID}': no API key — paste one via /connect`);

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: userText }],
    }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const result = (await res.json()) as { choices: { message: { content: string } }[] }
  return result.choices[0].message.content
}

export async function testConnection(providerID: string): Promise<boolean> {
  try { return (await chat(providerID, "models", "ping")).length >= 0; }
  catch { return false; }
}
