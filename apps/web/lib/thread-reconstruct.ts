import type { Answer, InvestigationWithAnswers } from '@evidata/answer-contract';

export interface ReconstructedTurn {
  question: string;
  answer: Answer;
}

/**
 * Rebuild the conversation from a stored thread (issue #40/#56): pair each user
 * question with the agent turn's answer version. A rerun (issue #56) appends a new
 * agent turn with NO preceding user turn — so it replaces the previous exchange's
 * answer with the newer version, showing the latest regenerated answer.
 */
export function exchangesFrom(thread: InvestigationWithAnswers): ReconstructedTurn[] {
  const byVersion = new Map(thread.answers.map((a) => [a.meta.version, a]));
  const out: ReconstructedTurn[] = [];
  let pendingQuestion: string | undefined;
  for (const turn of thread.turns) {
    if (turn.role === 'user') {
      pendingQuestion = turn.question;
    } else if (turn.role === 'agent' && turn.answerVersion !== undefined) {
      const answer = byVersion.get(turn.answerVersion);
      if (!answer) continue;
      if (pendingQuestion !== undefined) {
        out.push({ question: pendingQuestion, answer });
        pendingQuestion = undefined;
      } else if (out.length > 0) {
        // Rerun: regenerated answer for the prior question — show the latest version.
        out[out.length - 1] = { question: out[out.length - 1]!.question, answer };
      }
    }
  }
  return out;
}
