'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Answer } from '@evidata/answer-contract';
import { answerLabels, useI18n } from '@/lib/i18n';
import { useInvestigationStream, type UsageInfo } from '@/lib/use-investigation-stream';
import { AnswerView } from './answer-view';
import { Composer } from './composer';
import { EmptyState } from './empty-state';
import { ReasoningStream } from './reasoning-stream';
import { UsageFooter } from './usage-footer';

interface Exchange {
  question: string;
  answer?: Answer;
  error?: string;
  usage?: UsageInfo;
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

export function Thread({ onClear }: { onClear: () => void }) {
  const { t, lang } = useI18n();
  const labels = useMemo(() => answerLabels(t), [t]);
  const stream = useInvestigationStream({
    requestFailed: t('errorRequestFailed'),
    networkError: t('errorNetworkInterrupted'),
  });
  const { status, question, progress, answer, error, usage, ask, reset } = stream;
  const [history, setHistory] = useState<Exchange[]>([]);

  // When a turn settles (answered OR errored), move it into the conversation and
  // free the stream for the next question — the thread accumulates, never wipes.
  useEffect(() => {
    if (status !== 'done' && status !== 'error') return;
    if (!question) return;
    const settled: Exchange = answer
      ? { question, answer, ...(usage ? { usage } : {}) }
      : { question, error: error ?? t('genericError') };
    setHistory((h) => [...h, settled]);
    reset();
  }, [status, question, answer, error, usage, reset, t]);

  // `/clear` is a conversation command, not a question — reset to the empty state
  // (matches the chat-app convention the composer placeholder advertises).
  const submit = (q: string): void => {
    if (q.trim().toLowerCase() === '/clear') {
      onClear();
      return;
    }
    void ask(q, 'sample', lang);
  };
  const isEmpty = history.length === 0 && status === 'idle';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-6 pb-4">
        {isEmpty && <EmptyState onPick={submit} />}

        {history.map((ex, i) => (
          <div key={i} className="flex flex-col gap-4">
            <UserBubble text={ex.question} />
            {ex.answer ? (
              <>
                <AnswerView answer={ex.answer} onFollowup={submit} labels={labels} />
                {ex.usage && <UsageFooter usage={ex.usage} />}
              </>
            ) : (
              <ErrorBlock error={ex.error ?? t('genericError')} />
            )}
          </div>
        ))}

        {/* The in-flight / just-settled turn (covers streaming and the transient
            done|error commit before the effect moves it into history). */}
        {status !== 'idle' && question && (
          <div className="flex flex-col gap-4">
            <UserBubble text={question} />
            {answer ? (
              <>
                <AnswerView answer={answer} onFollowup={submit} labels={labels} />
                {usage && <UsageFooter usage={usage} />}
              </>
            ) : status === 'error' ? (
              <ErrorBlock error={error ?? t('genericError')} />
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
          disabled={status === 'streaming'}
          dataSourceName={t('sample')}
          placeholder={t('composerPlaceholder')}
        />
      </div>
    </div>
  );
}
