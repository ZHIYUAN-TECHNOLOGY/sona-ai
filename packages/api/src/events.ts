/**
 * Live updates: after a successful write, the API announces what changed (a topic, and the visit
 * when there is one) to the caller's hospital, and connected apps re-read just that. A change
 * carries no patient data; the app always reads through the same checked routes.
 */
export type Change = { topic: string; encounterId?: string };

// Calls that only read; everything else behind a login is a write.
const READS = new Set(["list", "get", "status", "beds", "ask", "read"]);

export function changeFor(path: readonly string[], input: unknown): Change | undefined {
  const [topic, verb] = path;
  if (!topic || !verb || READS.has(verb)) return undefined;
  const encounterId = (input as { encounterId?: unknown } | undefined)?.encounterId;
  return typeof encounterId === "string" ? { topic, encounterId } : { topic };
}
