/**
 * Live updates: after a successful write, the API announces what changed (a topic, and the visit
 * when there is one) to the caller's hospital, and connected apps re-read just that. A change
 * carries no patient data; the app always reads through the same checked routes. `patientId` (from
 * the input, or the Sona Care account that wrote) lets the Worker also tell that patient's app.
 */
export type Change = { topic: string; encounterId?: string; patientId?: string };

// Calls that only read; everything else behind a login is a write.
const READS = new Set(["list", "get", "status", "beds", "ask", "read", "slots"]);

export function changeFor(path: readonly string[], input: unknown): Change | undefined {
  const [topic, verb] = path;
  if (!topic || !verb || READS.has(verb)) return undefined;
  const { encounterId, patientId } = (input ?? {}) as { encounterId?: unknown; patientId?: unknown };
  return {
    topic,
    ...typeof encounterId === "string" ? { encounterId } : {},
    ...typeof patientId === "string" ? { patientId } : {},
  };
}
