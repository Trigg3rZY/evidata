import { describe, expect, it } from 'vitest';
import { reasoningProviderOptions } from './sdk-transport';

describe('reasoningProviderOptions (epic #106)', () => {
  it('maps a set effort to the openai-compatible reasoningEffort option', () => {
    // The @ai-sdk/openai-compatible provider turns openaiCompatible.reasoningEffort
    // into the `reasoning_effort` request field.
    expect(reasoningProviderOptions('low')).toEqual({
      openaiCompatible: { reasoningEffort: 'low' },
    });
    expect(reasoningProviderOptions('high')).toEqual({
      openaiCompatible: { reasoningEffort: 'high' },
    });
  });

  it('omits provider options when no effort is set (non-reasoning models unaffected)', () => {
    expect(reasoningProviderOptions(undefined)).toBeUndefined();
    expect(reasoningProviderOptions('')).toBeUndefined();
  });
});
