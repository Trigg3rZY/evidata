/**
 * Decision Boundaries → Unblock Path mapping (spec 03 §5).
 *
 * The runner builds the UnblockPath and picks the Answer status deterministically
 * from the trigger — never the provider. Two entry points: a provider-declared
 * `unblock` (MissingInfo[]) and a SafetyGate rejection.
 */
import type {
  AnswerStatus,
  MissingInfo,
  MissingKind,
  SafetyRejectReason,
  UnblockAction,
  UnblockPath,
} from './deps';

function actionsFor(kind: MissingKind): UnblockAction[] {
  switch (kind) {
    case 'business_object':
      return [{ kind: 'specify_object', label: 'Specify which object you mean' }];
    case 'time_range':
      return [{ kind: 'set_time_range', label: 'Set a time range' }];
    case 'authorization':
      return [{ kind: 'request_access', label: 'Request access', createsSuggestion: true }];
    case 'mutation_required':
      return [{ kind: 'view_mutation_draft', label: 'View the proposed change (not executed)' }];
    case 'ambiguous_definition':
      return [{ kind: 'pick_definition', label: 'Pick a definition' }];
    case 'unverified_mapping':
      return [
        { kind: 'notify_admin_verify', label: 'Notify an Admin to verify the mapping', createsSuggestion: true },
        { kind: 'narrow_question', label: 'Narrow the question to one area' },
      ];
    case 'insufficient_results':
      return [{ kind: 'narrow_question', label: 'Narrow the question' }];
  }
}

/** Status precedence: a policy block dominates, then unreliable, then clarification. */
function statusFor(kinds: ReadonlyArray<MissingKind>): AnswerStatus {
  if (kinds.some((k) => k === 'mutation_required' || k === 'authorization')) return 'BlockedByPolicy';
  if (kinds.some((k) => k === 'unverified_mapping' || k === 'insufficient_results')) return 'NoReliableAnswer';
  return 'NeedsClarification';
}

export interface UnblockResolution {
  status: AnswerStatus;
  unblock: UnblockPath;
}

export function resolveUnblock(missing: [MissingInfo, ...MissingInfo[]]): UnblockResolution {
  const kinds = missing.map((m) => m.kind);
  const steps: UnblockAction[] = [];
  const seen = new Set<string>();
  for (const m of missing) {
    for (const a of actionsFor(m.kind)) {
      if (!seen.has(a.kind)) {
        seen.add(a.kind);
        steps.push(a);
      }
    }
  }
  return {
    status: statusFor(kinds),
    unblock: {
      whatsMissing: missing,
      nextSteps: steps as [UnblockAction, ...UnblockAction[]],
    },
  };
}

/** Maps a SafetyGate rejection to the MissingInfo the runner unblocks from. */
export function gateRejectToMissing(
  reason: SafetyRejectReason,
  detail: string,
): [MissingInfo, ...MissingInfo[]] {
  switch (reason) {
    case 'not_read_only':
      return [{ kind: 'mutation_required', description: detail }];
    case 'unauthorized_table':
      return [{ kind: 'authorization', description: detail }];
    default:
      return [{ kind: 'insufficient_results', description: 'The proposed query could not be safely executed.' }];
  }
}
