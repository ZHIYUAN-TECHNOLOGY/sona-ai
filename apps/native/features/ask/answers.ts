import type { Spec } from "@json-render/core";

/**
 * Sona's answers on a page, built by rules from the app's own data (no model): each is a small
 * json-render spec from the ask catalogue. Scopes are the pages the ask bar sits on.
 */
export type Scope = "patients" | "tasks" | "ward" | "handover";
export type Tone = "urgent" | "soon" | "good" | "calm";
export type Row = { id: string; title: string; detail: string; tone: Tone; op?: string };
/** `worth` is whether the answer has anything to show; only then is it offered as the page's ✦ suggestion. */
export type Answer = { id: string; question: string; spec: Spec; worth: boolean };

export const SCOPE_LABEL: Record<Scope, string> = { patients: "Patients", tasks: "Your tasks", ward: "Ward 4B", handover: "Handover" };
export const PLACEHOLDER: Record<Scope, string> = { patients: "Ask about your patients…", tasks: "Ask about your tasks…", ward: "Ask about the ward…", handover: "Ask about the handover…" };

type Part = { type: "AskLead"; props: { text: string } } | { type: "AskRows"; props: { rows: Row[] } }
  | { type: "AskReview"; props: { title: string; items: string[]; what: string; confirm: string; done: string; op: string } }
  | { type: "AskActions"; props: { items: { label: string; op: string; primary?: boolean }[] } };

/** A column of parts as a spec, with stable element ids. */
export function column(id: string, parts: Part[]): Spec {
  const kept = parts.filter(p => p.type !== "AskRows" || p.props.rows.length);
  const elements: Spec["elements"] = { [`${id}-root`]: { type: "AskColumn", props: {}, children: kept.map((_, i) => `${id}-${i}`) } };
  kept.forEach((p, i) => { elements[`${id}-${i}`] = { type: p.type, props: p.props, children: [] }; });
  return { root: `${id}-root`, elements };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Patients: who needs you now, each opening their visit, and the page narrowed to them. */
export function needsYou(rows: Row[]): Answer {
  return { id: "needs", question: "Who needs me now?", worth: rows.length > 0, spec: column("needs", [
    { type: "AskLead", props: { text: rows.length ? `${plural(rows.length, "patient")} ${rows.length === 1 ? "needs" : "need"} you now, most urgent first.` : "Nobody needs you right now." } },
    { type: "AskRows", props: { rows } },
    ...(rows.length ? [{ type: "AskActions" as const, props: { items: [{ label: "Show only these", op: "tab:needs", primary: true }] } }] : []),
  ]) };
}

export type TaskLine = { id: string; patientId: string; patientName: string; title: string; owner: string; due: string; group: "overdue" | "today" | "week" | "later" };
/**
 * Tasks: what's overdue and due today; the most overdue one can be marked done after a review
 * (`review` false in live mode, where the server owns completion).
 */
export function overdue(tasks: TaskLine[], review = true): Answer {
  const late = tasks.filter(t => t.group === "overdue"), today = tasks.filter(t => t.group === "today");
  const first = late[0];
  return { id: "overdue", question: late.length ? "What's overdue?" : "What's due today?", worth: late.length + today.length > 0, spec: column("overdue", [
    { type: "AskLead", props: { text: late.length || today.length ? [late.length ? `${plural(late.length, "task")} overdue` : "", today.length ? `${today.length} due today` : ""].filter(Boolean).join(", ") + "." : "Nothing is overdue or due today." } },
    { type: "AskRows", props: { rows: [...late, ...today].slice(0, 8).map(t => ({ id: t.id, title: t.title, detail: `${t.patientName} · ${t.owner} · ${t.group === "overdue" ? `was due ${t.due}` : "due today"}`, tone: t.group === "overdue" ? "soon" as const : "calm" as const, op: `open:${t.patientId}` })) } },
    ...(first && review ? [{ type: "AskReview" as const, props: { title: `Mark “${first.title}” done`, items: [`${first.patientName} · ${first.owner}`, `Was due ${first.due}`], what: "Marks it done in this visit's tasks; you can reopen it under Completed.", confirm: "Mark done", done: `Marked done: ${first.title}`, op: `task-done:${first.patientId}:${first.id}` } }] : []),
  ]) };
}

export type BedLine = { bed: string; patientId?: string; name?: string; status: "fit" | "watch" | "stable" | "empty" | "free"; blockers: { label: string }[]; waitingHours?: number };
/** Ward: who can go home soonest, what holds each blocked bed, and the way into the ward. */
export function soonest(beds: BedLine[]): Answer {
  const fit = beds.filter(b => b.name && b.status === "fit");
  const clear = fit.filter(b => !b.blockers.length), held = fit.filter(b => b.blockers.length);
  const hours = held.reduce((n, b) => n + (b.waitingHours ?? 0), 0);
  return { id: "soonest", question: "Who can go home soonest?", worth: fit.length > 0, spec: column("soonest", [
    { type: "AskLead", props: { text: fit.length ? `${plural(clear.length, "bed")} can free now${held.length ? `; ${plural(held.length, "discharge")} ${held.length === 1 ? "is" : "are"} blocked, about ${hours} bed-hours waiting` : ""}.` : "Nobody on the ward is fit to go yet." } },
    { type: "AskRows", props: { rows: [...clear.map(b => ({ id: b.bed, title: `${b.bed} · ${b.name}`, detail: "Fit to go · nothing holding the bed", tone: "good" as const })),
      ...held.map(b => ({ id: b.bed, title: `${b.bed} · ${b.name}`, detail: `Blocked · ${b.blockers.map(x => x.label).join(", ")}`, tone: "soon" as const }))] } },
    ...(held.length ? [{ type: "AskActions" as const, props: { items: [{ label: "Show the blocked beds", op: "tab:blocked", primary: true }] } }] : []),
  ]) };
}

export type CardLine = { id: string; patientId?: string; name: string; priority: "watch" | "stable"; situation: string };
/** Handover: who to watch, in one line each. */
export function toWatch(cards: CardLine[]): Answer {
  const watch = cards.filter(c => c.priority === "watch");
  return { id: "watch", question: "Who should the next shift watch?", worth: watch.length > 0, spec: column("watch", [
    { type: "AskLead", props: { text: watch.length ? `${plural(watch.length, "patient")} to watch out of ${cards.length}.` : `Nobody to watch; all ${cards.length} are stable.` } },
    { type: "AskRows", props: { rows: watch.map(c => ({ id: c.id, title: c.name, detail: c.situation, tone: "urgent" as const, ...(c.patientId ? { op: `open:${c.patientId}` } : {}) })) } },
  ]) };
}

/** A typed question matched to this page's answers by its words; undefined when none fits. */
export function matchQuestion(text: string, answers: Answer[]): Answer | undefined {
  const t = text.toLowerCase();
  const words: Record<string, RegExp> = { needs: /need|urgent|attention|first|who/, overdue: /overdue|late|due|task/, soonest: /home|discharge|free|bed|soon/, watch: /watch|handover|hand over|sick|worr/ };
  return answers.find(a => words[a.id]?.test(t));
}
