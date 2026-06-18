'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Answer, Evidence, InvestigationWithAnswers } from '@evidata/answer-contract';
import { SAMPLE_DATA_SOURCE_ID } from '@evidata/connector-sample';
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
  onCreated,
  onInspect,
}: {
  onClear: () => void;
  /** When set, load and render this Investigation's saved thread (a follow-up continues it). */
  initialInvestigationId?: string | null;
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
  // Available data sources + the active one (M0: just "sample"). The composer shows a
  // real selector only when there's >1; the server binds a thread to its source for
  // its lifetime, so changing this only affects new questions.
  const [dataSources, setDataSources] = useState<ReadonlyArray<{ id: string; name: string }>>([]);
  const [dataSourceId, setDataSourceId] = useState<string>(SAMPLE_DATA_SOURCE_ID);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/data-sources')
      .then((r) => (r.ok ? (r.json() as Promise<Array<{ id: string; name: string }>>) : []))
      .then((d) => {
        if (cancelled || !Array.isArray(d) || d.length === 0) return;
        setDataSources(d);
        setDataSourceId((cur) => (d.some((x) => x.id === cur) ? cur : (d[0]?.id ?? cur)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
    const settled: Exchange = answer
      ? { question, answer, ...(usage ? { usage } : {}) }
      : message
        ? { question, message, ...(usage ? { usage } : {}) }
        : status === 'aborted'
          ? { question, stopped: true }
          : { question, error: error ?? t('genericError') };
    if (answer && wasRerun) {
      // Regenerate-in-place: replace the latest exchange's answer (keep its question).
      setHistory((h) =>
        h.length > 0
          ? [...h.slice(0, -1), { ...h[h.length - 1]!, answer, ...(usage ? { usage } : {}) }]
          : [settled],
      );
    } else {
      setHistory((h) => [...h, settled]);
    }
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
    void ask(q, dataSourceId, lang, investigationId ?? undefined);
  };
  // Regenerate the latest answer in place (issue #56): same question, rerun=true.
  const rerun = (q: string): void => {
    rerunRef.current = true;
    void ask(q, dataSourceId, lang, investigationId ?? undefined, true);
  };
  const isEmpty = history.length === 0 && status === 'idle';
  // Badge label: the sample keeps its localized name; any real source shows its own
  // name (so a single non-sample deployment never mislabels as "Sample").
  const activeSource = dataSources.find((d) => d.id === dataSourceId);
  const dataSourceName =
    activeSource && activeSource.id !== SAMPLE_DATA_SOURCE_ID ? activeSource.name : t('sample');

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

        {history.map((ex, i) => (
          <div key={i} className="flex flex-col gap-4">
            <UserBubble text={ex.question} />
            {ex.answer ? (
              <>
                <AnswerView
                  answer={ex.answer}
                  onFollowup={submit}
                  onInspect={onInspect}
                  onRerun={i === history.length - 1 ? () => rerun(ex.question) : undefined}
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
        ))}

        {/* The in-flight / just-settled turn (covers streaming and the transient
            done|error commit before the effect moves it into history). `inert`, not
            aria-hidden: it's a transient preview, so we remove it from the a11y tree
            AND make its controls (copy / follow-ups) non-focusable — never "hidden
            but tabbable". The settled exchange is announced once it lands in the log. */}
        {status !== 'idle' && question && (
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
              <ReasoningStream progress={progress} />
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
          dataSourceName={dataSourceName}
          dataSources={dataSources}
          dataSourceId={dataSourceId}
          onDataSourceChange={setDataSourceId}
          dataSourceLabel={t('dataSource')}
          sourceLocked={Boolean(investigationId)}
          placeholder={t('composerPlaceholder')}
          stopLabel={t('stop')}
        />
      </div>
    </div>
  );
}
