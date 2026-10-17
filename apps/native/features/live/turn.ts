// Metering is dBFS: above SPEECH counts as talking; a tap's turn ends (and Sona Live cuts a chunk) SILENCE_MS after the
// last speech (0.8 s, as voice assistants do: a longer wait reads as Sona being slow to answer).
export const SPEECH_DB = -38, SILENCE_MS = 800, MAX_MS = 30_000, NOTHING_MS = 7_000;

/** A tap's turn (or a Live chunk): send (read) it on a pause after speaking, give up if nothing is said, and stop at the cap either way. */
export function turnEnd({ spoke, quietFor, elapsed }: { spoke: boolean; quietFor: number; elapsed: number }): "send" | "drop" | undefined {
  if (elapsed > MAX_MS) return spoke ? "send" : "drop";
  if (spoke && quietFor > SILENCE_MS) return "send";
  if (!spoke && elapsed > NOTHING_MS) return "drop";
  return undefined;
}

/** Metering (dBFS) as 0–1 for the voice bars: a quiet room (-55) is flat, a raised voice (-15) is full height. */
export const loudness = (db: number) => Math.min(1, Math.max(0, (db + 55) / 40));
