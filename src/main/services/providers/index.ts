import { getAuth } from "../auth";

export interface ProviderInfo {
  id: string;
  name: string;
  baseUrl: string;
  envVars: string[];
};

export interface Credentials { baseUrl: string; apiKey: string };

export const CATALOG: Record<string, ProviderInfo> = {
  opencode: {
    id: "opencode", name: "OpenCode Zen",
    baseUrl: "https://opencode.ai/zen/v1",
    envVars: ["OPENCODE_API_KEY"],
  },
  "opencode-go": {
    id: "opencode-go", name: "OpenCode Go",
    baseUrl: "https://opencode.ai/zen/go/v1",
    envVars: ["OPENCODE_API_KEY"],
  },
};


export const listProviders = () => Object.values(CATALOG);

export async function getCredentials(providerId: string): Promise<Credentials> {
  const p = CATALOG[providerId];
  if (!p) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  const stored = await getAuth(providerId);
  const apiKey = stored?.key ?? p.envVars.map((v) => process.env[v]).find(Boolean) ?? "";
  return {
    baseUrl: p.baseUrl, apiKey
  }
}
