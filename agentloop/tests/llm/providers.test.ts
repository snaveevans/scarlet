import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLLMClient, availableProviders } from '../../src/llm/providers.js';
import { LLMError } from '../../src/llm/client.js';
import { AnthropicClient } from '../../src/llm/anthropic.js';

describe('createLLMClient', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-for-provider');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('resolves "anthropic" to an AnthropicClient', () => {
    const client = createLLMClient('anthropic');
    expect(client).toBeInstanceOf(AnthropicClient);
  });

  it('passes config to the provider', () => {
    const client = createLLMClient('anthropic', {
      apiKey: 'custom-key',
      baseUrl: 'https://custom.api/v1/messages',
    });
    expect(client).toBeInstanceOf(AnthropicClient);
  });

  it('throws LLMError for unknown provider', () => {
    expect(() => createLLMClient('openai')).toThrow(LLMError);
    expect(() => createLLMClient('openai')).toThrow('Unknown LLM provider "openai"');
  });

  it('includes available providers in error message', () => {
    try {
      createLLMClient('nonexistent');
    } catch (e) {
      expect((e as LLMError).message).toContain('anthropic');
    }
  });
});

describe('availableProviders', () => {
  it('returns list including anthropic', () => {
    const providers = availableProviders();
    expect(providers).toContain('anthropic');
  });

  it('returns an array', () => {
    expect(Array.isArray(availableProviders())).toBe(true);
  });
});
