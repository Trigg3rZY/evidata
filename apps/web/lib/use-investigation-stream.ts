'use client';

import { useCallback, useState } from 'react';
import type { Answer } from '@evidata/answer-contract';
import { parseSSE } from './sse';
import type { Lang } from './ask-stream';

export type StreamStatus = 'idle' | 'streaming' | 'done' | 'error';

export interface ProgressStep {
  kind: 'reasoning' | 'query';
  label: string;
  /** For query steps: 'running' | 'ok'. */
  state?: string;
}

export interface StreamState {
  status: StreamStatus;
  question: string | null;
  progress: ProgressStep[];
  answer: Answer | null;
  error: string | null;
}

const INITIAL: StreamState = {
  status: 'idle',
  question: null,
  progress: [],
  answer: null,
  error: null,
};

/** Apply one SSE message to the stream state. */
function reduce(state: StreamState, event: string, data: string): StreamState {
  switch (event) {
    case 'reasoning': {
      const { label } = JSON.parse(data) as { label: string };
      return { ...state, progress: [...state.progress, { kind: 'reasoning', label }] };
    }
    case 'query': {
      const { purpose, status } = JSON.parse(data) as { purpose: string; status: string };
      if (status === 'running') {
        return {
          ...state,
          progress: [...state.progress, { kind: 'query', label: purpose, state: 'running' }],
        };
      }
      // Mark the matching running step done rather than appending a duplicate.
      const progress = [...state.progress];
      for (let i = progress.length - 1; i >= 0; i--) {
        if (progress[i]?.kind === 'query' && progress[i]?.label === purpose) {
          progress[i] = { kind: 'query', label: purpose, state: 'ok' };
          break;
        }
      }
      return { ...state, progress };
    }
    case 'answer':
      return { ...state, answer: JSON.parse(data) as Answer };
    case 'done':
      return { ...state, status: 'done' };
    case 'error': {
      const { message } = JSON.parse(data) as { message: string };
      return { ...state, status: 'error', error: message };
    }
    default:
      return state;
  }
}

export interface UseInvestigationStream extends StreamState {
  ask: (question: string, dataSourceId?: string, language?: Lang) => Promise<void>;
  reset: () => void;
}

/** Drives one Ask Data turn over the SSE endpoint, accumulating progress + the final Answer. */
export function useInvestigationStream(): UseInvestigationStream {
  const [state, setState] = useState<StreamState>(INITIAL);

  const reset = useCallback(() => setState(INITIAL), []);

  const ask = useCallback(
    async (question: string, dataSourceId = 'sample', language: Lang = 'en') => {
      setState({ ...INITIAL, status: 'streaming', question });
      try {
        const res = await fetch('/api/investigations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question, dataSourceId, language }),
        });
        if (!res.ok || !res.body) {
          setState((s) => ({ ...s, status: 'error', error: 'The request could not be started.' }));
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { messages, rest } = parseSSE(buffer);
          buffer = rest;
          for (const m of messages) {
            setState((s) => reduce(s, m.event, m.data));
          }
        }
        // If the stream closed without an explicit done/error, settle as done.
        setState((s) => (s.status === 'streaming' ? { ...s, status: 'done' } : s));
      } catch {
        setState((s) => ({
          ...s,
          status: 'error',
          error: 'A network error interrupted the answer.',
        }));
      }
    },
    [],
  );

  return { ...state, ask, reset };
}
