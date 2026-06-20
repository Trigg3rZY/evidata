import { describe, expect, it } from 'vitest';
import {
  EFFORT_LEVELS,
  MODEL_KINDS,
  isEffortLevel,
  isModelKind,
  kindSupportsEffort,
} from './model-kinds';

describe('model-kinds (epic #106)', () => {
  it('recognizes the allowed kinds and rejects others', () => {
    for (const k of MODEL_KINDS) expect(isModelKind(k)).toBe(true);
    expect(isModelKind('mistral')).toBe(false);
    expect(isModelKind('')).toBe(false);
    // Native non-OpenAI vendors are not offered until their adapter lands — routing
    // them through the openai-compatible transport would fail at runtime.
    expect(isModelKind('anthropic')).toBe(false);
  });

  it('gates effort to effort-capable kinds (decision B)', () => {
    // OpenAI's reasoning models expose reasoning_effort; DeepSeek (and the rest, for
    // now) do not — so only `openai` is effort-capable.
    expect(kindSupportsEffort('openai')).toBe(true);
    expect(kindSupportsEffort('deepseek')).toBe(false);
    expect(kindSupportsEffort('google')).toBe(false);
    expect(kindSupportsEffort('anthropic')).toBe(false);
    expect(kindSupportsEffort('openai-compatible')).toBe(false);
  });

  it('validates effort levels', () => {
    for (const l of EFFORT_LEVELS) expect(isEffortLevel(l)).toBe(true);
    expect(isEffortLevel('extreme')).toBe(false);
    expect(isEffortLevel('')).toBe(false);
  });
});
