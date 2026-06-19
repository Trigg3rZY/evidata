import { describe, expect, it } from 'vitest';
import { lenientJson } from './json-repair';

/** lenientJson repairs the two malformations DeepSeek emits in tool-call args; it's
 *  applied by the loop's safeParse AND the SDK transport's repairToolCall hook. */
describe('lenientJson (DeepSeek tool-arg repair)', () => {
  const parse = (s: string): unknown => JSON.parse(lenientJson(s));

  it('escapes unescaped content quotes (quote-then-text)', () => {
    const bad = '{"text":"新增了 "Summer Sale" 活动"}';
    expect(parse(bad)).toEqual({ text: '新增了 "Summer Sale" 活动' });
  });

  it('escapes raw control characters inside strings', () => {
    const bad = '{"sql":"select 1\nfrom t"}'; // literal newline inside the JSON string
    expect(parse(bad)).toEqual({ sql: 'select 1\nfrom t' });
  });

  it('passes valid JSON through unchanged', () => {
    expect(parse('{"a":1,"b":"x"}')).toEqual({ a: 1, b: 'x' });
  });
});
