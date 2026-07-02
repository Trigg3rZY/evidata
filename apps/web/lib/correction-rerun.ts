/**
 * M2-B4 ② — the correction-loop auto-rerun (#123, spec 09 §3).
 *
 * When an Admin accepts a correction (a Suggested glossary term / mapping is promoted to
 * Verified), re-answer the investigation that raised it so the corrected knowledge is
 * reflected — but ONLY if that answer is still the conversation's head (if the user has
 * already followed up past it, re-answering an old turn would be noise; the Verified edit
 * still benefits future asks). Runs headless (no SSE) and best-effort: a failed rerun
 * leaves the existing answer in place. Returns whether a new Answer version was written.
 */
import type { Runtime } from './runtime';
import { providerFromConfig } from './runtime';

export async function rerunForCorrection(
  rt: Runtime,
  investigationId: string,
  raisedVersion: number | null,
  userId: string,
): Promise<boolean> {
  if (raisedVersion == null) return false;
  // Privileged internal read (no owner scope): the rerun is triggered by an Admin
  // accepting a correction, not by the thread's owner — scope would wrongly 404 (#177).
  const thread = await rt.service.getThreadUnchecked(investigationId);
  const latest = thread?.answers.at(-1)?.meta.version ?? null;
  // Head guard: only re-answer if the version that raised the correction is still latest.
  if (!thread || latest == null || latest !== raisedVersion) return false;

  // The model is bound to the investigation (#113); resolve it from the shared team pool
  // (#151 — any member resolves it, the key stays server-side).
  // A BOUND model that can't resolve must NOT silently fall back to a different model
  // (#111) — that would persist a correction answer from the wrong model. Skip instead.
  const modelProviderId = await rt.service.getInvestigationModelProviderId(investigationId);
  if (!modelProviderId) return false;
  const cfg = await rt.modelProviders.resolveConfig(modelProviderId).catch(() => null);
  if (!cfg) return false; // bound but unresolvable → don't re-answer with the wrong model
  const provider = providerFromConfig(cfg);

  // `ask` re-resolves the question internally for the rerun.
  const question = [...thread.turns].reverse().find((t) => t.role === 'user')?.question ?? '';
  try {
    const result = await rt.service.ask(
      {
        investigationId,
        dataSourceId: thread.dataSourceId,
        question,
        language: 'en', // chrome-only; the answer follows the question's language
        userId,
        correction: true,
        // Atomic head guard: only append if the version that raised the correction is
        // STILL the head at save time (a follow-up may have landed since the pre-check).
        expectedLatestVersion: raisedVersion,
      },
      { provider },
    );
    return result.kind === 'answer';
  } catch {
    return false; // best-effort: the Verified edit stands even if the rerun fails
  }
}
