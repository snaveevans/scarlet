import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MODEL_ROUTING,
  mergeModelRouting,
  resolveModel,
  type ModelRouting,
} from '../../src/llm/routing.js';

describe('model routing', () => {
  it('resolves default routing table models by phase', () => {
    expect(resolveModel(DEFAULT_MODEL_ROUTING, 'explore').model).toBe('claude-opus-4-6');
    expect(resolveModel(DEFAULT_MODEL_ROUTING, 'decompose').model).toBe('claude-opus-4-6');
    expect(resolveModel(DEFAULT_MODEL_ROUTING, 'validate-plan').model).toBe(
      'claude-sonnet-4-5-20250929',
    );
    expect(resolveModel(DEFAULT_MODEL_ROUTING, 'scaffold').model).toBe(
      'claude-haiku-4-5-20251001',
    );
    expect(resolveModel(DEFAULT_MODEL_ROUTING, 'review').model).toBe('claude-opus-4-6');
    expect(resolveModel(DEFAULT_MODEL_ROUTING, 'reflect').model).toBe('claude-opus-4-6');
  });

  it('resolves code model by complexity', () => {
    expect(resolveModel(DEFAULT_MODEL_ROUTING, 'code', 'low').model).toBe(
      'claude-haiku-4-5-20251001',
    );
    expect(resolveModel(DEFAULT_MODEL_ROUTING, 'code', 'medium').model).toBe(
      'claude-sonnet-4-5-20250929',
    );
    expect(resolveModel(DEFAULT_MODEL_ROUTING, 'code', 'high').model).toBe(
      'claude-opus-4-6',
    );
  });

  it('uses phase override when provided', () => {
    const routing = mergeModelRouting(DEFAULT_MODEL_ROUTING, {
      overrides: [
        {
          phase: 'review',
          model: { model: 'claude-sonnet-4-5-20250929' },
        },
      ],
    });

    expect(resolveModel(routing, 'review').model).toBe('claude-sonnet-4-5-20250929');
  });

  it('falls back to default model when phase has no override', () => {
    const model = resolveModel(DEFAULT_MODEL_ROUTING, 'nonexistent-phase');
    expect(model.model).toBe(DEFAULT_MODEL_ROUTING.default.model);
    expect(model.provider).toBe(DEFAULT_MODEL_ROUTING.default.provider);
  });

  it('merges partial routing overrides with defaults', () => {
    const base: ModelRouting = DEFAULT_MODEL_ROUTING;
    const merged = mergeModelRouting(base, {
      default: { maxTokens: 4096 },
      overrides: [
        {
          phase: 'code',
          complexity: 'high',
          model: { model: 'claude-opus-4-6-fast' },
        },
      ],
    });

    expect(merged.default.maxTokens).toBe(4096);
    expect(resolveModel(merged, 'code', 'high').model).toBe('claude-opus-4-6-fast');
    expect(resolveModel(merged, 'code', 'high').provider).toBe('anthropic');
    expect(resolveModel(merged, 'review').model).toBe('claude-opus-4-6');
  });
});
