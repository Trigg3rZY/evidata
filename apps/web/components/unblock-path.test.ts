import { describe, expect, it } from 'vitest';
import {
  canRevealMutationDraft,
  correctionAckFromResponse,
  shouldFileSuggestion,
} from './unblock-path';

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

describe('canRevealMutationDraft', () => {
  it('only reveals a blocked mutation when the rejected SQL is threaded through', () => {
    expect(
      canRevealMutationDraft({
        kind: 'view_mutation_draft',
        draftSql: 'update campaign_spend set amount = 0',
      }),
    ).toBe(true);
    expect(canRevealMutationDraft({ kind: 'view_mutation_draft' })).toBe(false);
    expect(canRevealMutationDraft({ kind: 'narrow_question' })).toBe(false);
  });
});

describe('correctionAckFromResponse', () => {
  it('only says a correction was recorded when the route accepted it', () => {
    expect(correctionAckFromResponse({ ok: true })).toBe('recorded');
    expect(correctionAckFromResponse({ ok: false })).toBe('sample');
    expect(correctionAckFromResponse(null)).toBe('sample');
  });
});
