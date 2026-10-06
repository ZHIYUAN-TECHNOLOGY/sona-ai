/** The thread's pure parts: what state a message is in, and the optimistic add, swap and roll back. */
export type ThreadMessage = { id: string; from: string; text: string; createdAt: Date | string; seenAt?: Date | string | null };

export type MessageState = "sending" | "sent" | "seen" | "replied";

export const SENDING = "sending:";

/** A patient message is replied once the care team writes after it, seen once they open it, else sent. */
export function stateOf(thread: readonly ThreadMessage[], index: number): MessageState {
  const m = thread[index]!;
  if (m.id.startsWith(SENDING)) return "sending";
  for (let i = index + 1; i < thread.length; i++) if (thread[i]!.from !== "patient") return "replied";
  return m.seenAt ? "seen" : "sent";
}

export const addSending = <T extends ThreadMessage>(thread: readonly T[] | undefined, draft: T): T[] => [...(thread ?? []), draft];

/** The stored message takes the sending one's place (once, even if a refetch already brought it). */
export function settle<T extends ThreadMessage>(thread: readonly T[] | undefined, requestId: string, sent: T): T[] {
  const rest = (thread ?? []).filter(m => m.id !== SENDING + requestId && m.id !== sent.id);
  return [...rest, sent];
}

export const rollBack = <T extends ThreadMessage>(thread: readonly T[] | undefined, requestId: string): T[] =>
  (thread ?? []).filter(m => m.id !== SENDING + requestId);

export const timeOf = (at: Date | string) => new Date(at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
