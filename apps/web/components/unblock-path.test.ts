import { describe, expect, it } from 'vitest';
import { shouldFileSuggestion } from './unblock-path';

describe('shouldFileSuggestion', () => {
  it('files request_access instead of only acknowledging it locally', () => {
    expect(shouldFileSuggestion({ kind: 'request_access', createsSuggestion: true })).toBe(true);
  });

  it('keeps pick_definition on the correction route even without createsSuggestion', () => {
    expect(shouldFileSuggestion({ kind: 'pick_definition' })).toBe(true);
  });

  it('does not file plain follow-up actions', () => {
    expect(shouldFileSuggestion({ kind: 'narrow_question' })).toBe(false);
  });
});
