import type { Profile } from '../../../shared/types'
import type { LLMProvider } from './provider'
import { OpenAICompatProvider } from './openaiCompat'
import { OllamaProvider } from './ollama'

/**
 * Resolves a stored profile to a concrete provider instance.
 * Adding a provider = one adapter file + one case here.
 */
export function createProvider(profile: Profile): LLMProvider {
  switch (profile.type) {
    case 'openai-compat':
      return new OpenAICompatProvider(profile.baseUrl, profile.apiKey ?? '', profile.model ?? '')
    case 'ollama':
      return new OllamaProvider(profile.baseUrl, profile.model ?? '')
    default: {
      const exhaustive: never = profile.type
      throw new Error(`unknown provider type: ${String(exhaustive)}`)
    }
  }
}