// Metering is dBFS: above SPEECH counts as talking; a tap's turn ends SILENCE_MS after the last speech.
export const SPEECH_DB = -38, SILENCE_MS = 1300, MAX_MS = 30_000, NOTHING_MS = 7_000;

/** A tap's turn: send on a pause after speaking, give up if nothing is said, and stop at the cap either way. */
export function turnEnd({ spoke, quietFor, elapsed }: { spoke: boolean; quietFor: number; elapsed: number }): "send" | "drop" | undefined {
  if (elapsed > MAX_MS) return spoke ? "send" : "drop";
  if (spoke && quietFor > SILENCE_MS) return "send";
  if (!spoke && elapsed > NOTHING_MS) return "drop";
  return undefined;
}
