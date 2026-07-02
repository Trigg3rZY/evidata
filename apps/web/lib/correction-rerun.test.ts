import { describe, expect, it, vi } from 'vitest';
import { rerunForCorrection } from './correction-rerun';
import type { Runtime } from './runtime';

/** A minimal Runtime stub — only the methods rerunForCorrection touches. */
function mockRuntime(
  latest: number | null,
  askKind: 'answer' | 'message' = 'answer',
  modelProviderId: string | null = 'mp-1',
) {
  const ask = vi.fn().mockResolvedValue({ kind: askKind });
  const thread =
    latest == null
      ? null
      : {
          dataSourceId: 'ds-1',
          turns: [{ role: 'user', question: 'why up?' }],
          answers: [{ meta: { version: latest } }],
        };
  const getThread = vi.fn().mockResolvedValue(thread);
  const rt = {
    service: {
      getThread,
      getThreadUnchecked: getThread, // rerun uses the unchecked read (#177)
      getInvestigationModelProviderId: vi.fn().mockResolvedValue(modelProviderId),
      ask,
    },
    modelProviders: {
      resolveConfig: vi.fn().mockResolvedValue({
        apiKey: 'k',
        baseURL: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
      }),
    },
  } as unknown as Runtime;
  return { rt, ask };
}

describe('rerunForCorrection (M2-B4 ②)', () => {
  it('re-answers when the raised version is still the head', async () => {
    const { rt, ask } = mockRuntime(3);
    expect(await rerunForCorrection(rt, 'inv-1', 3, 'admin')).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0]).toMatchObject({
      investigationId: 'inv-1',
      correction: true,
      userId: 'admin',
    });
  });

  it('skips (no rerun) when the user has moved the conversation past it', async () => {
    const { rt, ask } = mockRuntime(5); // latest is 5, the correction was raised on 3
    expect(await rerunForCorrection(rt, 'inv-1', 3, 'admin')).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });

  it('skips when there is no raised version, or no thread', async () => {
    const a = mockRuntime(3);
    expect(await rerunForCorrection(a.rt, 'inv-1', null, 'admin')).toBe(false);
    expect(a.ask).not.toHaveBeenCalled();

    const b = mockRuntime(null);
    expect(await rerunForCorrection(b.rt, 'inv-1', 1, 'admin')).toBe(false);
    expect(b.ask).not.toHaveBeenCalled();
  });

  it('is best-effort: a message result (no answer) counts as not reran', async () => {
    const { rt } = mockRuntime(2, 'message');
    expect(await rerunForCorrection(rt, 'inv-1', 2, 'admin')).toBe(false);
  });

  it('skips a bound model that cannot resolve — no silent fallback (#111)', async () => {
    const ask = vi.fn().mockResolvedValue({ kind: 'answer' });
    const getThread = vi.fn().mockResolvedValue({
      dataSourceId: 'ds-1',
      turns: [{ role: 'user', question: 'q' }],
      answers: [{ meta: { version: 2 } }],
    });
    const rt = {
      service: {
        getThread,
        getThreadUnchecked: getThread, // #177
        getInvestigationModelProviderId: vi.fn().mockResolvedValue('mp-deleted'),
        ask,
      },
      modelProviders: { resolveConfig: vi.fn().mockResolvedValue(null) },
    } as unknown as Runtime;
    expect(await rerunForCorrection(rt, 'inv-1', 2, 'admin')).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });

  it('skips an unbound investigation because there is no default model fallback (#170)', async () => {
    const { rt, ask } = mockRuntime(2, 'answer', null);
    expect(await rerunForCorrection(rt, 'inv-1', 2, 'admin')).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });
});
