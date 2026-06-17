/**
 * Answer versioning helpers (PRD: follow-ups produce new Answer versions; prior
 * versions are never overwritten). Pure functions over the contract types so the
 * InvestigationService (later phase) and tests share one implementation. (C5)
 */
import type { Answer, AnswerVersionMeta } from './answer-contract';

export type VersionTrigger = NonNullable<AnswerVersionMeta['createdAfter']>['kind'];

export interface AppendVersionOptions {
  createdAt: string; // ISO-8601
  trigger: VersionTrigger;
  fromVersion?: number;
}

/**
 * Append `draft` as the next Answer version after `prior`:
 * - version = max(prior versions) + 1 (monotonic, 1-based),
 * - the new version is marked `isLatest`, all prior versions demoted,
 * - `createdAfter` records what produced this version,
 * - prior versions are preserved (returned unchanged except `isLatest`).
 */
export function appendAnswerVersion(
  prior: ReadonlyArray<Answer>,
  draft: Answer,
  opts: AppendVersionOptions,
): Answer[] {
  const nextVersion = prior.reduce((max, a) => Math.max(max, a.meta.version), 0) + 1;

  const demoted = prior.map((a) =>
    a.meta.isLatest ? { ...a, meta: { ...a.meta, isLatest: false } } : a,
  );

  const createdAfter: AnswerVersionMeta['createdAfter'] =
    opts.fromVersion === undefined
      ? { kind: opts.trigger }
      : { kind: opts.trigger, fromVersion: opts.fromVersion };

  const next: Answer = {
    ...draft,
    meta: {
      ...draft.meta,
      version: nextVersion,
      isLatest: true,
      createdAt: opts.createdAt,
      createdAfter,
    },
  };

  return [...demoted, next];
}
