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
// literal so Tailwind v4 detects them. Labels are passed in (the catalog), so
// this stays a pure function of its props.
const STATUS: Record<AnswerStatus, { icon: LucideIcon; cls: string }> = {
  Answered: {
    icon: CircleCheck,
    cls: 'bg-status-answered-bg text-status-answered',
  },
  NeedsClarification: {
    icon: CircleHelp,
    cls: 'bg-status-clarify-bg text-status-clarify',
  },
  Partial: {
    icon: CircleDashed,
    cls: 'bg-status-partial-bg text-status-partial',
  },
  BlockedByPolicy: {
    icon: Lock,
    cls: 'bg-status-blocked-bg text-status-blocked',
  },
  NoReliableAnswer: {
    icon: CircleSlash,
    cls: 'bg-status-unreliable-bg text-status-unreliable',
  },
};

export function StatusBadge({
  status,
  labels,
}: {
  status: AnswerStatus;
  labels: Record<AnswerStatus, string>;
}) {
  const { icon: Icon, cls } = STATUS[status];
  const label = labels[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  );
}
