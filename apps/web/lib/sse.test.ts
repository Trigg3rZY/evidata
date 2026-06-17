import { describe, expect, it } from 'vitest';
import { parseSSE } from './sse';

describe('parseSSE', () => {
  it('parses complete frames and keeps the partial remainder', () => {
    const { messages, rest } = parseSSE(
      'event: reasoning\ndata: {"label":"a"}\n\nevent: query\ndata: {"purpose":"p"}\n\nevent: answer\ndata: {"status":"Answer',
    );
    expect(messages).toEqual([
      { event: 'reasoning', data: '{"label":"a"}' },
      { event: 'query', data: '{"purpose":"p"}' },
    ]);
    expect(rest).toBe('event: answer\ndata: {"status":"Answer');
  });

  it('defaults the event name and ignores blank blocks', () => {
    const { messages } = parseSSE('data: {"x":1}\n\n\n\n');
    expect(messages).toEqual([{ event: 'message', data: '{"x":1}' }]);
  });

  it('returns no messages until a frame terminator arrives', () => {
    const { messages, rest } = parseSSE('event: done\ndata: {}');
    expect(messages).toEqual([]);
    expect(rest).toBe('event: done\ndata: {}');
  });
});
