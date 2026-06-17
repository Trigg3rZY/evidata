/** Shared fixtures for contract tests. Not part of the public export surface. */
import type {
  Answer,
  AnswerStatus,
  Confidence,
  Evidence,
  UnblockPath,
} from './answer-contract';

export function evidenceFixture(id: string): Evidence {
  return {
    id,
    purpose: 'Measure spend by campaign',
    dataSourceId: 'sample',
    dataSourceName: 'Sample',
    connectorId: 'sample',
    tables: ['invoices'],
    sql: 'SELECT campaign, sum(amount) FROM invoices GROUP BY campaign',
    resultSummary: 'Summer Sale accounts for 40% of spend.',
    execution: { status: 'ok', elapsedMs: 7, rowCount: 3, truncated: false },
    safety: 'auto_executed',
    policyNotes: 'Read-only · row limit 1000 · auto-executed (low risk)',
    redactedColumns: [],
  };
}

export function unblockFixture(): UnblockPath {
  return {
    whatsMissing: [
      { kind: 'unverified_mapping', description: 'invoices.customer_ref → accounts.id is Suggested' },
    ],
    nextSteps: [
      { kind: 'notify_admin_verify', label: 'Notify an Admin to verify', createsSuggestion: true },
    ],
  };
}

/** A minimal, schema-valid `Answered` answer. Override fields per test. */
export function answeredFixture(): Answer {
  return {
    investigationId: 'inv-1',
    status: 'Answered',
    directAnswer: "ACME's ad bill rose because of the Summer Sale campaign.",
    confidence: 'High',
    confidenceReason: 'Two corroborating queries over invoices and usage.',
    keyFindings: [{ text: 'Summer Sale spend up 40% MoM', evidenceIds: ['E1'] }],
    evidence: [evidenceFixture('E1')],
    assumptions: [],
    caveats: [],
    recommendedFollowups: [{ question: 'Break down Summer Sale by day?' }],
    meta: { version: 1, createdAt: '2026-06-17T00:00:00.000Z', isLatest: true },
  };
}

/** A schema-valid answer for an arbitrary status × confidence (adds Unblock for non-Answered). */
export function answerForStatus(status: AnswerStatus, confidence: Confidence): Answer {
  const a = answeredFixture();
  a.status = status;
  a.confidence = confidence;
  if (status !== 'Answered') {
    a.unblock = unblockFixture();
  }
  return a;
}
