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
import { makeProvider, providerFromConfig } from './runtime';

export async function rerunForCorrection(
  rt: Runtime,
  investigationId: string,
  raisedVersion: number | null,
  userId: string,
): Promise<boolean> {
  if (raisedVersion == null) return false;
  const thread = await rt.service.getThread(investigationId);
  const latest = thread?.answers.at(-1)?.meta.version ?? null;
  // Head guard: only re-answer if the version that raised the correction is still latest.
  if (!thread || latest == null || latest !== raisedVersion) return false;

  // The model is bound to the investigation (#113); resolve it from the shared team pool
  // (#151 — any member resolves it, the key stays server-side). null → the env default.
  const modelProviderId = await rt.service.getInvestigationModelProviderId(investigationId);
  let providerFor = makeProvider;
  if (modelProviderId) {
    const cfg = await rt.modelProviders.resolveConfig(modelProviderId).catch(() => null);
    if (cfg) providerFor = () => providerFromConfig(cfg);
  }

  // Build the provider from the stored latest question (the fixture path keys off it; the
  // real provider ignores it). `ask` re-resolves the question internally for the rerun.
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
      },
      { provider: providerFor(question) },
    );
    return result.kind === 'answer';
  } catch {
    return false; // best-effort: the Verified edit stands even if the rerun fails
  }
}
