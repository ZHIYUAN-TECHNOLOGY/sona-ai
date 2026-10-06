/** The thread's pure parts: what state a message is in, and the optimistic add, swap and roll back. */
export type ThreadMessage = { id: string; from: string; text: string; createdAt: Date | string; seenAt?: Date | string | null; rule?: string | null };

export type MessageState = "sending" | "sent" | "seen" | "replied";

export const SENDING = "sending:";

/** A patient message is replied once the care team writes after it, seen once they open it, else sent. */
export function stateOf(thread: readonly ThreadMessage[], index: number): MessageState {
  const m = thread[index]!;
  if (m.id.startsWith(SENDING)) return "sending";
  for (let i = index + 1; i < thread.length; i++) if (thread[i]!.from !== "patient") return "replied";
  return m.seenAt ? "seen" : "sent";
}

/** The header line: where the conversation stands, from the newest message only. */
export function leadOf(thread: readonly ThreadMessage[], now: Date = new Date()): string {
  const last = thread.at(-1);
  if (!last) return "No messages yet. Write your first one below.";
  const day = dayOf(last.createdAt, now);
  const when = `${day === "Today" ? "" : day === "Yesterday" ? "yesterday " : `on ${day} `}at ${clockOf(last.createdAt)}`;
  if (last.from === "patient") return `You wrote ${when}. Waiting for a reply.`;
  return last.rule ? `Sona sent an automatic safety reply ${when}.` : `Your care team replied ${when}.`;
}

/** The line above the composer: the state of the patient's newest message, or nothing once the care team has answered. */
export function statusOf(thread: readonly ThreadMessage[]): string | null {
  const i = thread.length - 1;
  if (i < 0 || thread[i]!.from !== "patient") return null;
  return STATUS[stateOf(thread, i)];
}
const STATUS: Record<MessageState, string> = { sending: "Sending…", sent: "Sent. Your care team will see it.", seen: "Seen by your care team", replied: "Replied" };

export const addSending = <T extends ThreadMessage>(thread: readonly T[] | undefined, draft: T): T[] => [...(thread ?? []), draft];

/** The stored message takes the sending one's place (once, even if a refetch already brought it). */
export function settle<T extends ThreadMessage>(thread: readonly T[] | undefined, requestId: string, sent: T): T[] {
  const rest = (thread ?? []).filter(m => m.id !== SENDING + requestId && m.id !== sent.id);
  return [...rest, sent];
}

export const rollBack = <T extends ThreadMessage>(thread: readonly T[] | undefined, requestId: string): T[] =>
  (thread ?? []).filter(m => m.id !== SENDING + requestId);

export const timeOf = (at: Date | string) => new Date(at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** "9:41 am": the time under a bubble (the day is the separator above it). */
export const clockOf = (at: Date | string) => new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** "Today", "Yesterday" or "Mon 5 Oct": the separator above a day's messages. */
export function dayOf(at: Date | string, now: Date = new Date()): string {
  const d = new Date(at), start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
