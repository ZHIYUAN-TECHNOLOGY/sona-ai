/**
 * Gemma's evidence answer (JSON) read while it is still being written: the bottom line once its string has closed, and
 * each claim once its object has closed, so the app can show them as they are written instead of after the last word.
 * The finished answer is still read whole (jsonIn) and checked as before; this only lets the parts arrive early.
 */

/** A string under `key` whose closing quote has arrived: its value, unescaped; undefined while it is still open. */
function closedString(text: string, key: string): string | undefined {
  const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(text);
  if (!m) return undefined;
  try { return JSON.parse(`"${m[1]}"`) as string; } catch { return undefined; }
}

/** The objects of the array under `key` that have closed so far; the one still being written is left out. */
function closedObjects(text: string, key: string): unknown[] {
  const start = new RegExp(`"${key}"\\s*:\\s*\\[`).exec(text);
  if (!start) return [];
  const out: unknown[] = [];
  let depth = 0, from = -1, inString = false, escaped = false;
  for (let i = start.index + start[0].length; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") { if (depth++ === 0) from = i; }
    else if (c === "}") {
      if (--depth === 0 && from >= 0) { try { out.push(JSON.parse(text.slice(from, i + 1))); } catch { /* not a whole object */ } from = -1; }
    } else if (c === "]" && depth === 0) break;
  }
  return out;
}

/** What of the answer is already written: its bottom line, and its claims so far (raw, checked by the caller). */
export const partialEvidence = (text: string) => ({ bottomLine: closedString(text, "bottomLine"), claims: closedObjects(text, "claims") });
