'use client';

import { useI18n } from '@/lib/i18n';
import { useInvestigationStream } from '@/lib/use-investigation-stream';
import { AnswerView } from './answer-view';
import { Composer } from './composer';
import { ReasoningStream } from './reasoning-stream';

export function Thread() {
  const { t, lang } = useI18n();
  const { status, question, progress, answer, error, ask } = useInvestigationStream();

  return (
    <div className="flex flex-col gap-6">
      {question && (
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-sm">
            {question}
          </div>
        </div>
      )}

      {status === 'streaming' && !answer && <ReasoningStream progress={progress} />}

      {answer && <AnswerView answer={answer} onFollowup={(q) => void ask(q, 'sample', lang)} />}

      {status === 'error' && error && (
        <div className="rounded-md border border-border bg-status-blocked-bg px-3 py-2 text-sm text-status-blocked">
          {error}
        </div>
      )}

      <Composer
        onSubmit={(q) => void ask(q, 'sample', lang)}
        disabled={status === 'streaming'}
        dataSourceName={t('sample')}
        placeholder={t('composerPlaceholder')}
      />
    </div>
  );
}
