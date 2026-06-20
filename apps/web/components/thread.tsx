'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Answer, Evidence, InvestigationWithAnswers } from '@evidata/answer-contract';
import { exchangesFrom } from '@/lib/thread-reconstruct';
import { answerLabels, useI18n } from '@/lib/i18n';
import {
  useInvestigationStream,
  type MessageInfo,
  type UsageInfo,
} from '@/lib/use-investigation-stream';
import { AnswerView } from './answer-view';
import { Composer } from './composer';
import { EmptyState } from './empty-state';
import { MessageBubble } from './message-bubble';
import { ReasoningStream } from './reasoning-stream';
import { UsageFooter } from './usage-footer';

interface Exchange {
  question: string;
  answer?: Answer;
  message?: MessageInfo;
  error?: string;
  usage?: UsageInfo;
  stopped?: boolean;
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-sm">
        {text}
      </div>
    </div>
  );
}

function ErrorBlock({ error }: { error: string }) {
  return (
    <div className="rounded-md border border-border bg-status-blocked-bg px-3 py-2 text-sm text-status-blocked">
      {error}
    </div>
  );
}

function StoppedBlock({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
      {label}
    </div>
  );
}

export function Thread({
  onClear,
  initialInvestigationId,
  dataSourceId,
  modelProviderId,
  onCreated,
  onInspect,
}: {
  onClear: () => void;
  /** When set, load and render this Investigation's saved thread (a follow-up continues it). */
  initialInvestigationId?: string | null;
  /** The active source for a NEW question (owned by the shell, shown in the top nav). A
   *  follow-up ignores it server-side — the source is bound to the Investigation. */
  dataSourceId: string;
  /** Selected model for the turn (epic #106); null/undefined = the server default.
   *  Sent per turn as `modelProviderId`. (Per-investigation binding lands later.) */
  modelProviderId?: string | null;
  /** Called after an Answer settles, so the history rail can refresh. */
  onCreated?: () => void;
  /** Open an evidence item in the right-pane inspector (issue #49). */
  onInspect?: (evidence: Evidence) => void;
}) {
  const { t, lang } = useI18n();
  const labels = useMemo(() => answerLabels(t), [t]);
  const stream = useInvestigationStream({
    requestFailed: t('errorRequestFailed'),
    networkError: t('errorNetworkInterrupted'),
  });
  const { status, question, progress, answer, message, error, usage, ask, reset, stop } = stream;
  const [history, setHistory] = useState<Exchange[]>([]);
  // The active Investigation: set from the first/most-recent Answer; subsequent
  // questions continue it as versioned follow-ups (a Message doesn't establish one).
  const [investigationId, setInvestigationId] = useState<string | null>(
    initialInvestigationId ?? null,
  );
  const [loading, setLoading] = useState(Boolean(initialInvestigationId));
  // Set while a Rerun is in flight, so the settle effect replaces the latest
  // exchange's answer in place instead of appending a new turn (issue #56).
  const rerunRef = useRef(false);
  // True while a rerun streams: the latest answer is shown as "Regenerating…" with live
  // progress in place, instead of staying visible and snapping to the new one (issue #64).
  const [regenerating, setRegenerating] = useState(false);

  // Load a past Investigation's saved thread when selected from the history rail.
  // (The component is remounted per selection via `key`, so this runs once.)
  useEffect(() => {
    if (!initialInvestigationId) return;
    let cancelled = false;
    fetch(`/api/investigations/${encodeURIComponent(initialInvestigationId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<InvestigationWithAnswers>) : null))
      .then((thread) => {
        if (cancelled) return;
        // Don't clobber a turn the user already started before the load returned
        // (the composer is also disabled while loading) — only seed an empty thread.
        if (thread) setHistory((h) => (h.length === 0 ? exchangesFrom(thread) : h));
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialInvestigationId]);

  // When a turn settles (answered, replied, errored, or stopped), move it into the
  // conversation and free the stream — the thread accumulates, never wipes.
  useEffect(() => {
    if (status !== 'done' && status !== 'error' && status !== 'aborted') return;
    if (!question) return;
    const wasRerun = rerunRef.current;
    rerunRef.current = false;
    if (wasRerun) setRegenerating(false);
    const settled: Exchange = answer
      ? { question, answer, ...(usage ? { usage } : {}) }
      : message
        ? { question, message, ...(usage ? { usage } : {}) }
        : status === 'aborted'
          ? { question, stopped: true }
          : { question, error: error ?? t('genericError') };
    if (wasRerun) {
      // Regenerate-in-place: on success, replace the latest exchange's answer; on a
      // failed/stopped rerun, keep the existing answer (never append a spurious turn).
      if (answer) {
        setHistory((h) =>
          h.length > 0
            ? [...h.slice(0, -1), { ...h[h.length - 1]!, answer, ...(usage ? { usage } : {}) }]
            : [settled],
        );
        setInvestigationId(answer.investigationId);
        onCreated?.();
      }
      reset();
      return;
    }
    setHistory((h) => [...h, settled]);
    // An Answer establishes/continues the Investigation; later turns continue it,
    // and the history rail refreshes (a new thread appears / order updates).
    if (answer) {
      setInvestigationId(answer.investigationId);
      onCreated?.();
    }
    reset();
  }, [status, question, answer, message, error, usage, reset, t, onCreated]);

  // `/clear` is a conversation command, not a question — reset to the empty state
  // (matches the chat-app convention the composer placeholder advertises).
  const submit = (q: string): void => {
    if (q.trim().toLowerCase() === '/clear') {
      onClear();
      return;
    }
    void ask(q, dataSourceId, lang, investigationId ?? undefined, false, modelProviderId);
  };
  // Regenerate the latest answer in place (issues #56/#64): same question, rerun=true.
  // `regenerating` swaps the latest answer for live progress until the new one lands.
  const rerun = (q: string): void => {
    rerunRef.current = true;
    setRegenerating(true);
    void ask(q, dataSourceId, lang, investigationId ?? undefined, true, modelProviderId);
  };
  const isEmpty = history.length === 0 && status === 'idle';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The conversation is a log of messages (role="log"): assistive tech announces
          each settled exchange as it's appended and can navigate the thread. */}
      <div role="log" aria-label={t('conversation')} className="flex flex-1 flex-col gap-6 pb-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">…</p>
        ) : (
          isEmpty && <EmptyState onPick={submit} />
        )}

        {history.map((ex, i) => {
          const isLast = i === history.length - 1;
          return (
            <div key={i} className="flex flex-col gap-4">
              <UserBubble text={ex.question} />
              {isLast && regenerating ? (
                // Regenerate-in-place: the prior answer yields to live progress until
                // the new version lands (issue #64) — no abrupt snap, no duplicate turn.
                <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                      aria-hidden
                    />
                    <span>{t('regenerating')}</span>
                  </div>
                  <ReasoningStream progress={progress} thinkingLabel={t('thinking')} />
                </div>
              ) : ex.answer ? (
                <>
                  <AnswerView
                    answer={ex.answer}
                    onFollowup={submit}
                    onInspect={onInspect}
                    onRerun={isLast ? () => rerun(ex.question) : undefined}
                    labels={labels}
                  />
                  {ex.usage && <UsageFooter usage={ex.usage} />}
                </>
              ) : ex.message ? (
                <>
                  <MessageBubble message={ex.message} />
                  {ex.usage && <UsageFooter usage={ex.usage} />}
                </>
              ) : ex.stopped ? (
                <StoppedBlock label={t('stopped')} />
              ) : (
                <ErrorBlock error={ex.error ?? t('genericError')} />
              )}
            </div>
          );
        })}

        {/* The in-flight / just-settled turn (covers streaming and the transient
            done|error commit before the effect moves it into history). `inert`, not
            aria-hidden: it's a transient preview, so we remove it from the a11y tree
            AND make its controls (copy / follow-ups) non-focusable — never "hidden
            but tabbable". The settled exchange is announced once it lands in the log. */}
        {status !== 'idle' && question && !regenerating && (
          <div className="flex flex-col gap-4" inert>
            <UserBubble text={question} />
            {answer ? (
              <>
                <AnswerView answer={answer} onFollowup={submit} labels={labels} />
                {usage && <UsageFooter usage={usage} />}
              </>
            ) : message ? (
              <>
                <MessageBubble message={message} />
                {usage && <UsageFooter usage={usage} />}
              </>
            ) : status === 'error' ? (
              <ErrorBlock error={error ?? t('genericError')} />
            ) : status === 'aborted' ? (
              <StoppedBlock label={t('stopped')} />
            ) : (
              <ReasoningStream progress={progress} thinkingLabel={t('thinking')} />
            )}
          </div>
        )}

        <div className="sr-only" role="status" aria-live="polite">
          {answer ? t('answerReady') : ''}
        </div>
      </div>

      <div className="sticky bottom-0 bg-background pb-4 pt-2">
        <Composer
          onSubmit={submit}
          onStop={stop}
          streaming={status === 'streaming'}
          disabled={status === 'streaming' || loading}
          placeholder={t('composerPlaceholder')}
          stopLabel={t('stop')}
        />
      </div>
    </div>
  );
}
