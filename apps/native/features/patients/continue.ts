/**
 * Continue ("where you left off"): the patients whose work this clinician started and has not
 * finished, so the sidebar can offer them back at any census size (docs/design-direction.md,
 * Information architecture). Pure rules; `continue-store.ts` keeps the state.
 */
export const CONTINUE_LIMIT = 3;
export const PIN_LIMIT = 5;
export const IDLE_MS = 24 * 60 * 60 * 1000;

export type Pin = { id: string; at: number };
/** A visit this clinician worked on: when last touched, whether it was closed, and what is left (undefined: nothing). */
export type Started = { id: string; lastAt: number; closed?: boolean; left?: string };
export type Entry = { id: string; why: "open" | "pinned" | "recent"; left?: string; lastAt?: number };

/**
 * Who is in Continue, in order: the visit open now, then pins (newest first), then unfinished work
 * from the last 24 h (newest first). A closed visit leaves unless pinned; a pinned patient stays
 * until unpinned. Everyone appears once.
 */
export function continueList({ current, pins, started, now }: { current?: string; pins: Pin[]; started: Started[]; now: number }): Entry[] {
  const byId = new Map(started.map(s => [s.id, s]));
  const out: Entry[] = [];
  const add = (e: Entry) => { if (!out.some(o => o.id === e.id)) out.push(e); };
  const open = current ? byId.get(current) : undefined;
  if (open && !open.closed) add({ id: open.id, why: "open", left: open.left, lastAt: open.lastAt });
  for (const p of [...pins].sort((a, b) => b.at - a.at)) add({ id: p.id, why: "pinned", left: byId.get(p.id)?.left, lastAt: byId.get(p.id)?.lastAt });
  for (const s of [...started].sort((a, b) => b.lastAt - a.lastAt)) if (!s.closed && s.left && now - s.lastAt < IDLE_MS) add({ id: s.id, why: "recent", left: s.left, lastAt: s.lastAt });
  return out;
}

/** Pinning: already pinned is a no-op; under the cap adds; at the cap names the oldest pin to replace (the caller asks first). */
export function planPin(pins: Pin[], id: string, now: number): { pins: Pin[] } | { replace: Pin } {
  if (pins.some(p => p.id === id)) return { pins };
  if (pins.length < PIN_LIMIT) return { pins: [...pins, { id, at: now }] };
  return { replace: [...pins].sort((a, b) => a.at - b.at)[0]! };
}
export const replacePin = (pins: Pin[], oldest: string, id: string, now: number): Pin[] => [...pins.filter(p => p.id !== oldest), { id, at: now }];

/**
 * What is still open on a visit, in a few words, or undefined when nothing is left and it can be
 * closed. Follow-up tasks don't hold a visit open: once set, they belong to their owners.
 */
export function whatIsLeft(e: { answers: number; hasNote: boolean; noteReviewed: boolean; recording: string }): string | undefined {
  if (e.recording === "recording" || e.recording === "paused") return "Recording paused";
  if (e.hasNote && !e.noteReviewed) return "Draft note to sign";
  if (!e.hasNote && e.answers) return "Note not started";
  return undefined;
}
