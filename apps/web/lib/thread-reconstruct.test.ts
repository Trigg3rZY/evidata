import { describe, expect, it } from 'vitest';
import type { Answer, InvestigationWithAnswers, Turn } from '@evidata/answer-contract';
import { exchangesFrom } from './thread-reconstruct';

const answer = (version: number, isLatest: boolean, directAnswer: string): Answer =>
  ({ directAnswer, meta: { version, createdAt: '', isLatest } }) as unknown as Answer;

const userTurn = (question: string): Turn => ({
  id: `u${question}`,
  role: 'user',
  question,
  createdAt: '',
});
const agentTurn = (answerVersion: number): Turn => ({
  id: `a${answerVersion}`,
  role: 'agent',
  answerVersion,
  createdAt: '',
});

const thread = (turns: Turn[], answers: Answer[]): InvestigationWithAnswers => ({
  id: 'inv',
  dataSourceId: 'sample',
  title: 't',
  createdAt: '',
  updatedAt: '',
  turns,
  answers,
});

describe('exchangesFrom', () => {
  it('pairs each user question with its agent answer (multi-turn)', () => {
    const out = exchangesFrom(
      thread(
        [userTurn('Q1'), agentTurn(1), userTurn('Q2'), agentTurn(2)],
        [answer(1, false, 'A1'), answer(2, true, 'A2')],
      ),
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ question: 'Q1', answer: { directAnswer: 'A1' } });
    expect(out[1]).toMatchObject({ question: 'Q2', answer: { directAnswer: 'A2' } });
  });

  it('shows the latest version for a rerun (agent turn with no user turn)', () => {
    const out = exchangesFrom(
      thread(
        [userTurn('Q1'), agentTurn(1), agentTurn(2)], // v2 is a rerun: no new user turn
        [answer(1, false, 'A1'), answer(2, true, 'A2-regenerated')],
      ),
    );
    expect(out).toHaveLength(1); // one exchange, regenerated in place
    expect(out[0]).toMatchObject({ question: 'Q1', answer: { directAnswer: 'A2-regenerated' } });
  });
});
