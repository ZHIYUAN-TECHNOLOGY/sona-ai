import type { client } from "@/lib/orpc";

export type CheckIn = Awaited<ReturnType<typeof client.checkIns.list>>[number];
export type Reply = CheckIn["replies"][number];
export type Tab = "action" | "waiting" | "done";
export type Row = CheckIn & { patientName: string; reply?: Reply; state: Tab; at: number };

type Shape = Pick<CheckIn, "sentAt" | "dueAt"> & { replies: Pick<Reply, "label" | "receivedAt" | "task">[] };

/** The reply the row shows: the one still flagged for the care team, else the newest. */
export const shownReply = <R extends Shape["replies"][number]>(replies: R[]) =>
  replies.findLast(r => r.task && !r.task.completed) ?? replies.at(-1);

/** Needs action while a flagged reply's task is open; waiting while sent and unanswered; otherwise done. */
export function stateOf(c: Shape): Tab {
  if (c.replies.some(r => r.task && !r.task.completed)) return "action";
  return c.replies.length ? "done" : "waiting";
}

const RANK = { urgent: 0, worse: 1, fine: 2 } as const;
const rank = (r: { state: Tab; reply?: { label: keyof typeof RANK } }) => (r.state === "action" && r.reply ? RANK[r.reply.label] : 2);
/** Red flags, then worse, then newest. */
export const byUrgency = <R extends { state: Tab; reply?: { label: keyof typeof RANK }; at: number }>(a: R, b: R) => rank(a) - rank(b) || b.at - a.at;

/** Sent check-ins (or ones already replied to) as table rows; scheduled, unsent ones have nothing to show yet. */
export function toRows(list: CheckIn[], names: Map<string, string>): Row[] {
  return list.filter(c => c.sentAt || c.replies.length).map(c => {
    const reply = shownReply(c.replies);
    return { ...c, patientName: names.get(c.patientId) ?? c.patientId, reply, state: stateOf(c), at: new Date(reply?.receivedAt ?? c.sentAt ?? c.dueAt).getTime() };
  }).sort(byUrgency);
}

/** Day N is counted from the discharge's calendar day, so the discharge day is the due day minus N. */
export const dischargedOn = (c: Pick<CheckIn, "dueAt" | "day">) => new Date(new Date(c.dueAt).getTime() - c.day * 86_400_000);

export const LABEL = {
  urgent: { text: "Red flag", tone: "urgent" },
  worse: { text: "Worse", tone: "soon" },
  fine: { text: "Fine", tone: "done" },
} as const;
