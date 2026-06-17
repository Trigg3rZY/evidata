import {
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleSlash,
  Lock,
  type LucideIcon,
} from 'lucide-react';
import type { AnswerStatus } from '@evidata/answer-contract';

// Status is the only place loud color lives (spec 11 §4). Class strings are
// literal so Tailwind v4 detects them.
const STATUS: Record<AnswerStatus, { icon: LucideIcon; label: string; cls: string }> = {
  Answered: {
    icon: CircleCheck,
    label: 'Answered',
    cls: 'bg-status-answered-bg text-status-answered',
  },
  NeedsClarification: {
    icon: CircleHelp,
    label: 'Needs clarification',
    cls: 'bg-status-clarify-bg text-status-clarify',
  },
  Partial: {
    icon: CircleDashed,
    label: 'Partial',
    cls: 'bg-status-partial-bg text-status-partial',
  },
  BlockedByPolicy: {
    icon: Lock,
    label: 'Blocked by policy',
    cls: 'bg-status-blocked-bg text-status-blocked',
  },
  NoReliableAnswer: {
    icon: CircleSlash,
    label: 'No reliable answer',
    cls: 'bg-status-unreliable-bg text-status-unreliable',
  },
};

export function StatusBadge({ status }: { status: AnswerStatus }) {
  const { icon: Icon, label, cls } = STATUS[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  );
}
