'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

/** Cumulative cost of a turn (real model only): tokens, model round-trips, queries. */
export interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  calls: number;
  queries: number;
}

export interface StreamState {
  status: StreamStatus;
  question: string | null;
  progress: ProgressStep[];
  answer: Answer | null;
  error: string | null;
  usage: UsageInfo | null;
}

const INITIAL: StreamState = {
  status: 'idle',
  question: null,
  progress: [],
  answer: null,
  error: null,
  usage: null,
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
      // Mark the matching running step done. The runner executes queries
      // sequentially (one running at a time), so the most-recent running step
      // with this purpose is unambiguously the one that just finished.
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
    case 'usage':
      return { ...state, usage: JSON.parse(data) as UsageInfo };
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

/**
 * Localized text for the two client-side stream failures. Passed in (not held as
 * English literals) so the messages follow the active language; the catalog in
 * `lib/i18n` is the single source. The server's own `error` frame is separate.
 */
export interface StreamErrorMessages {
  requestFailed: string;
  networkError: string;
}

/** Drives one Ask Data turn over the SSE endpoint, accumulating progress + the final Answer. */
export function useInvestigationStream(errorMessages: StreamErrorMessages): UseInvestigationStream {
  const [state, setState] = useState<StreamState>(INITIAL);
  const controllerRef = useRef<AbortController | null>(null);
  // Keep the latest localized messages reachable from the stable `ask` callback
  // without rebuilding it on every language change. (Local `messages` below is
  // the parsed SSE batch — distinct from these failure strings.)
  const errorMessagesRef = useRef(errorMessages);
  errorMessagesRef.current = errorMessages;

  // Abort any in-flight stream on unmount (no state updates after unmount).
  useEffect(() => () => controllerRef.current?.abort(), []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    setState(INITIAL);
  }, []);

  const ask = useCallback(
    async (question: string, dataSourceId = 'sample', language: Lang = 'en') => {
      controllerRef.current?.abort(); // supersede any in-flight turn
      const controller = new AbortController();
      controllerRef.current = controller;
      setState({ ...INITIAL, status: 'streaming', question });
      try {
        const res = await fetch('/api/investigations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question, dataSourceId, language }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          setState((s) => ({
            ...s,
            status: 'error',
            error: errorMessagesRef.current.requestFailed,
          }));
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
        // Superseded/unmounted aborts are intentional — don't surface them.
        if (controller.signal.aborted) return;
        setState((s) => ({
          ...s,
          status: 'error',
          error: errorMessagesRef.current.networkError,
        }));
      }
    },
    [],
  );

  return { ...state, ask, reset };
}
