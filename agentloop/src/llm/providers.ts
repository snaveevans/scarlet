/**
 * LLM provider registry.
 *
 * Resolves a provider name (e.g. `"anthropic"`) to a configured {@link LLMClient}.
 * V1 only supports Anthropic — the registry pattern lets us add
 * OpenAI / OpenRouter / Ollama later without changing calling code.
 */

import type { LLMClient } from './client.js';
import { LLMError } from './client.js';
import { AnthropicClient } from './anthropic.js';
import type { AnthropicClientOptions } from './anthropic.js';

// ---------------------------------------------------------------------------
// Provider config
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  /** Provider-specific options (e.g. API key, base URL). */
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const PROVIDERS: Record<
  string,
  (config: ProviderConfig) => LLMClient
> = {
  anthropic: (config) =>
    new AnthropicClient({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
    } satisfies AnthropicClientOptions),
};

/**
 * Create an LLM client for the given provider.
 *
 * @throws {LLMError} if the provider name is not recognized.
 */
export function createLLMClient(
  provider: string,
  config: ProviderConfig = {},
): LLMClient {
  const factory = PROVIDERS[provider];
  if (!factory) {
    const known = Object.keys(PROVIDERS).join(', ');
    throw new LLMError(
      `Unknown LLM provider "${provider}". Available: ${known}`,
      undefined,
      false,
    );
  }
  return factory(config);
}

/** List all registered provider names. */
export function availableProviders(): string[] {
  return Object.keys(PROVIDERS);
}
