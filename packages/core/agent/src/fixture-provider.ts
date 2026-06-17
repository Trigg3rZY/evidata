/**
 * FixtureProvider (spec 03 §7) — replays a scripted sequence of AgentDecisions,
 * deterministically and with no model API key. It is stateless: the next step is
 * derived from how far the run has progressed (`reasoning + toolResults` seen),
 * so the same script always produces the same run. The default exit is an honest
 * non-answer, so an exhausted script can never hang the loop.
 */
import type { AgentDecision, AgentHistory, AgentInput, AgentProvider } from './types';

export class FixtureProvider implements AgentProvider {
  constructor(private readonly script: ReadonlyArray<AgentDecision>) {}

  next(_input: AgentInput, history: AgentHistory): Promise<AgentDecision> {
    const step = history.reasoning.length + history.toolResults.length;
    const next =
      this.script[step] ??
      ({
        kind: 'unblock',
        missing: [{ kind: 'insufficient_results', description: 'Fixture script exhausted.' }],
      } satisfies AgentDecision);
    return Promise.resolve(next);
  }
}
