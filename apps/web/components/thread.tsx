'use client';

import { useEffect, useState } from 'react';
import type { Answer } from '@evidata/answer-contract';
import { useI18n } from '@/lib/i18n';
import { useInvestigationStream } from '@/lib/use-investigation-stream';
import { AnswerView } from './answer-view';
import { Composer } from './composer';
import { EmptyState } from './empty-state';
import { ReasoningStream } from './reasoning-stream';

interface Exchange {
  question: string;
  answer: Answer;
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

export function Thread() {
  const { t, lang } = useI18n();
  const stream = useInvestigationStream();
  const { status, question, progress, answer, error, ask, reset } = stream;
  const [history, setHistory] = useState<Exchange[]>([]);

  // When a turn settles with an answer, move it into the conversation and free
  // the stream for the next question (the thread accumulates; it doesn't wipe).
  useEffect(() => {
    if (status === 'done' && question && answer) {
      setHistory((h) => [...h, { question, answer }]);
      reset();
    }
  }, [status, question, answer, reset]);

  const submit = (q: string): void => void ask(q, 'sample', lang);
  const isEmpty = history.length === 0 && status === 'idle';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-6 pb-4">
        {isEmpty && <EmptyState onPick={submit} />}

        {history.map((ex, i) => (
          <div key={i} className="flex flex-col gap-4">
            <UserBubble text={ex.question} />
            <AnswerView answer={ex.answer} onFollowup={submit} />
          </div>
        ))}

        {status === 'streaming' && question && (
          <div className="flex flex-col gap-4">
            <UserBubble text={question} />
            {answer ? (
              <AnswerView answer={answer} onFollowup={submit} />
            ) : (
              <ReasoningStream progress={progress} />
            )}
          </div>
        )}

        {/* Announce arrival to screen readers without dumping the whole answer. */}
        <div className="sr-only" role="status" aria-live="polite">
          {answer ? 'Answer ready.' : ''}
        </div>

        {status === 'error' && (
          <div className="flex flex-col gap-4">
            {question && <UserBubble text={question} />}
            <div className="rounded-md border border-border bg-status-blocked-bg px-3 py-2 text-sm text-status-blocked">
              {error}
            </div>
          </div>
        )}
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
