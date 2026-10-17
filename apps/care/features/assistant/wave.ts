/**
 * The dictation pill's numbers, kept pure so they can be tested. The recorder meters in dBFS: -55 dB
 * (a quiet room) and below draws the resting tick, -10 dB (a raised voice) the full bar. A floor keeps
 * every bar visible, so silence reads as "still listening", not as "broken".
 */
export const bar = (db: number) => Math.max(0.12, Math.min(1, (db + 55) / 45));

/** m:ss for the running timer (0:07, 1:02). */
export const clock = (ms: number) => {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * The live words as pieces that fade in one by one: a word (Malay, English; `space` when one follows it, drawn as a
 * margin since a Text's trailing space isn't always measured) or one Chinese character (no spaces to split on).
 * Keyed by place and word, so a piece that comes back unchanged in the next partial stays still; only new or revised
 * pieces fade in.
 */
const HAN = "\\u3000-\\u303f\\u3400-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef";
const PIECE = new RegExp(`[${HAN}]\\s*|[^\\s${HAN}]+\\s*`, "g");
export const pieces = (text: string) => (text.trim().match(PIECE) ?? []).map((piece, i) => {
  const word = piece.trimEnd();
  return { key: `${i}:${word}`, word, space: word !== piece };
});
