import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLLMClient, availableProviders } from '../../src/llm/providers.js';
import { LLMError } from '../../src/llm/client.js';
import { AnthropicClient } from '../../src/llm/anthropic.js';
import { OpenAIClient } from '../../src/llm/openai.js';

describe('createLLMClient', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-for-provider');
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key-for-provider');
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

  it('resolves "openai" to an OpenAIClient', () => {
    const client = createLLMClient('openai');
    expect(client).toBeInstanceOf(OpenAIClient);
  });

  it('throws LLMError for unknown provider', () => {
    expect(() => createLLMClient('nonexistent')).toThrow(LLMError);
    expect(() => createLLMClient('nonexistent')).toThrow(
      'Unknown LLM provider "nonexistent"',
    );
  });

  it('includes available providers in error message', () => {
    try {
      createLLMClient('nonexistent');
    } catch (e) {
      expect((e as LLMError).message).toContain('anthropic');
      expect((e as LLMError).message).toContain('openai');
    }
  });
});

describe('availableProviders', () => {
  it('returns list including anthropic and openai', () => {
    const providers = availableProviders();
    expect(providers).toContain('anthropic');
    expect(providers).toContain('openai');
  });

  it('returns an array', () => {
    expect(Array.isArray(availableProviders())).toBe(true);
  });
});
