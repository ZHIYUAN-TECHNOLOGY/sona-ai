export type Part = string | { n: number };

/** Splits summary text at `[n]` markers that name a known source; an unknown `[n]` stays as text. */
export function splitMarkers(text: string, known: readonly number[]): Part[] {
  const parts: Part[] = [];
  text.split(/\[(\d+)\]/).forEach((piece, i) => {
    const n = Number(piece);
    const part: Part = i % 2 === 0 ? piece : known.includes(n) ? { n } : `[${piece}]`;
    const last = parts.at(-1);
    if (typeof part === "string" && typeof last === "string") parts[parts.length - 1] = last + part;
    else if (part !== "") parts.push(part);
  });
  return parts;
}
