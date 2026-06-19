import { describe, expect, it } from 'vitest';
import { type Answer, type KeyFinding, validateAnswer } from './answer-contract';
import { answeredFixture, chartFixture } from './test-fixtures';

function codes(a: Answer): string[] {
  return validateAnswer(a).map((v) => v.code);
}

describe('validateAnswer', () => {
  it('returns no violations for a well-formed Answered answer (G3)', () => {
    expect(validateAnswer(answeredFixture())).toEqual([]);
  });

  it('flags an illegal status × confidence', () => {
    const a = answeredFixture();
    a.confidence = 'CannotDetermine'; // illegal for Answered
    expect(codes(a)).toContain('illegal_status_confidence');
  });

  it('flags a missing confidenceReason', () => {
    const a = answeredFixture();
    a.confidenceReason = '   ';
    expect(codes(a)).toContain('missing_confidence_reason');
  });

  it('flags a Key Finding with no Evidence (guardrail: every finding cites evidence)', () => {
    const a = answeredFixture();
    // Simulate malformed agent output: empty evidenceIds (violates the type).
    a.keyFindings = [
      { text: 'unsupported claim', evidenceIds: [] as unknown as KeyFinding['evidenceIds'] },
    ];
    expect(codes(a)).toContain('finding_without_evidence');
  });

  it('flags a Key Finding citing unknown Evidence', () => {
    const a = answeredFixture();
    a.keyFindings = [{ text: 'cites a ghost', evidenceIds: ['E9'] }];
    expect(codes(a)).toContain('dangling_evidence_ref');
  });

  it('flags a non-Answered status without an Unblock Path', () => {
    const a = answeredFixture();
    a.status = 'NoReliableAnswer';
    a.confidence = 'CannotDetermine';
    expect(codes(a)).toContain('missing_unblock_on_non_answer');
  });

  it('flags Answered with zero Key Findings', () => {
    const a = answeredFixture();
    a.keyFindings = [];
    expect(codes(a)).toContain('answered_without_findings');
  });

  it('accepts a well-formed chart citing existing Evidence', () => {
    const a = answeredFixture();
    a.charts = [chartFixture('C1', 'E1')];
    expect(validateAnswer(a)).toEqual([]);
  });

  it('flags a chart citing unknown Evidence', () => {
    const a = answeredFixture();
    a.charts = [chartFixture('C1', 'E9')];
    expect(codes(a)).toContain('dangling_chart_evidence_ref');
  });

  it('flags a Key Finding citing an unknown chart', () => {
    const a = answeredFixture();
    a.charts = [chartFixture('C1', 'E1')];
    a.keyFindings = [{ text: 'anchors to a ghost chart', evidenceIds: ['E1'], chartRef: 'C9' }];
    expect(codes(a)).toContain('dangling_finding_chart_ref');
  });

  it('accepts a Key Finding anchoring to an existing chart', () => {
    const a = answeredFixture();
    a.charts = [chartFixture('C1', 'E1')];
    a.keyFindings = [{ text: 'anchors to C1', evidenceIds: ['E1'], chartRef: 'C1' }];
    expect(validateAnswer(a)).toEqual([]);
  });
});
