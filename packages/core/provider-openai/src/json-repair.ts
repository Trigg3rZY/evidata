/**
 * Best-effort repair of the two malformations DeepSeek emits in tool-call
 * arguments — both invalid JSON the strict parser rejects, losing an otherwise-good
 * answer:
 *   1. Unescaped ASCII double-quotes inside string values (e.g. `新增了 "Summer Sale" 活动`).
 *   2. Raw control characters (literal newlines/tabs) inside string values.
 *
 * Shared by the loop (`safeParse`) and the SDK transport's `repairToolCall` hook so
 * the hardening survives the move to the Vercel AI SDK (which parses tool args
 * itself and would otherwise reject these). Only tried after a strict parse fails.
 *
 * We walk the text tracking string state. A `"` inside a string is the closing
 * quote only when the next non-space char is structural (`:,}]`) or input ends;
 * otherwise it's content and gets escaped. Control chars inside strings are escaped
 * (\n/\t/\r) or dropped (other C0).
 *
 * KNOWN GAP: a content quote immediately before a structural char (e.g. `他说"对",然后`)
 * is misread as the terminator, so that input is NOT repaired — it then fails to
 * parse → empty draft → contract re-prompt / honest non-answer; never a silently
 * wrong answer. The DeepSeek cases seen in practice are quote-then-text.
 */
const STRUCTURAL: ReadonlySet<string> = new Set([':', ',', '}', ']']);

export function lenientJson(s: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] as string;
    if (esc) {
      out += ch;
      esc = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      esc = true;
      continue;
    }
    if (!inStr) {
      if (ch === '"') inStr = true;
      out += ch;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      for (;;) {
        const cj = s[j];
        if (cj === undefined || cj.trim() !== '') break;
        j++;
      }
      const next = s[j];
      if (next === undefined || STRUCTURAL.has(next)) {
        inStr = false;
        out += ch;
      } else {
        out += '\\"'; // content quote → escape
      }
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code < 0x20) {
      out += code === 0x0a ? '\\n' : code === 0x09 ? '\\t' : code === 0x0d ? '\\r' : '';
      continue;
    }
    out += ch;
  }
  return out;
}
