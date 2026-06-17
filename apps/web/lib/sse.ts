/**
 * Minimal client-side SSE frame parser. Pure and incremental: feed it the
 * running buffer, get back complete messages plus the unconsumed remainder.
 */
export interface SSEMessage {
  event: string;
  data: string;
}

export function parseSSE(buffer: string): { messages: SSEMessage[]; rest: string } {
  const blocks = buffer.split('\n\n');
  const rest = blocks.pop() ?? '';
  const messages: SSEMessage[] = [];

  for (const block of blocks) {
    if (!block.trim()) continue;
    let event = 'message';
    let data = '';
    // Our server emits exactly one single-line JSON `data:` per frame, so a
    // simple concat is correct here. (A general SSE parser would join multiple
    // `data:` lines with "\n" and not trim significant whitespace.)
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (data) messages.push({ event, data });
  }
  return { messages, rest };
}
