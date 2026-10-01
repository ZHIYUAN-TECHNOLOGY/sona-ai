import type { Spec } from "@json-render/core";
import { formatRM } from "@sona-ai/domain/audit";
import { bedKind } from "@sona-ai/domain/ward";
import { waited } from "@/features/inbox/state";

/**
 * Sona's answers on a page, built by rules from the app's own data (no model): each is a small
 * json-render spec from the ask catalogue. Scopes are the pages the ask bar sits on.
 */
export type Scope = "today" | "patients" | "tasks" | "ward" | "handover" | "discharge" | "claim" | "xray" | "inbox" | "audit" | "training" | "note" | "scan";
export type Tone = "urgent" | "soon" | "good" | "calm";
export type Row = { id: string; title: string; detail: string; tone: Tone; op?: string };
/**
 * `worth` is whether the answer has anything to show; only then is it offered as the page's ✦ suggestion.
 * `action` is what that suggestion says when the answer leads to a review card (it still opens the answer, then the review, then a receipt).
 */
export type Answer = { id: string; question: string; spec: Spec; worth: boolean; action?: string };

export const SCOPE_LABEL: Record<Scope, string> = { discharge: "This discharge", claim: "This guarantee letter", xray: "This X-ray", today: "Your day", patients: "Patients", tasks: "Your tasks", ward: "Ward 4B", handover: "Handover", inbox: "Messages", audit: "Coding audit", training: "Training data", note: "This note", scan: "This scan" };
export const PLACEHOLDER: Record<Scope, string> = { discharge: "Ask about this discharge…", claim: "Ask about this letter…", xray: "Ask about this X-ray…", today: "Ask about your day…", patients: "Ask about your patients…", tasks: "Ask about your tasks…", ward: "Ask about the ward…", handover: "Ask about the handover…", inbox: "Ask about your messages…", audit: "Ask about the audit…", training: "Ask about training data…", note: "Ask about this note…", scan: "Ask about this scan…" };

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
/** Free text (a reason, a task title) cut to what the catalogue allows. */
const clip = (text: string, length: number) => text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;

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
  return { id: "overdue", question: late.length ? "What's overdue?" : "What's due today?", worth: late.length + today.length > 0, ...(first && review ? { action: `Mark “${first.title}” done` } : {}), spec: column("overdue", [
    { type: "AskLead", props: { text: late.length || today.length ? [late.length ? `${plural(late.length, "task")} overdue` : "", today.length ? `${today.length} due today` : ""].filter(Boolean).join(", ") + "." : "Nothing is overdue or due today." } },
    { type: "AskRows", props: { rows: [...late, ...today].slice(0, 8).map(t => ({ id: t.id, title: t.title, detail: `${t.patientName} · ${t.owner} · ${t.group === "overdue" ? `was due ${t.due}` : "due today"}`, tone: t.group === "overdue" ? "soon" as const : "calm" as const, op: `open:${t.patientId}` })) } },
    ...(first && review ? [{ type: "AskReview" as const, props: { title: `Mark “${first.title}” done`, items: [`${first.patientName} · ${first.owner}`, `Was due ${first.due}`], what: "Marks it done in this visit's tasks; you can reopen it under Completed.", confirm: "Mark done", done: `Marked done: ${first.title}`, op: `task-done:${first.patientId}:${first.id}` } }] : []),
  ]) };
}

export type BedLine = { bed: string; patientId?: string; name?: string; status: "fit" | "watch" | "stable" | "empty" | "free"; blockers: { label: string }[]; waitingHours?: number };
/** Ward: who can go home soonest, what holds each blocked bed, and the way into the ward. */
export function soonest(beds: BedLine[]): Answer {
  const clear = beds.filter(b => bedKind(b) === "fit"), held = beds.filter(b => bedKind(b) === "blocked"), fit = [...clear, ...held];
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
    { type: "AskRows", props: { rows: watch.map(c => ({ id: c.id, title: c.name, detail: c.situation, tone: "soon" as const, ...(c.patientId ? { op: `open:${c.patientId}` } : {}) })) } },
  ]) };
}

/** The page's ✦ suggestion for the dock: the first answer with something to show, worded as its review when it has one. */
export function suggestion(answers: Answer[]): { answer: Answer; text: string } | undefined {
  const answer = answers.find(a => a.worth);
  return answer && { answer, text: answer.action ?? answer.question };
}

/** An answer's lead sentence (its AskLead), which Sona Live says above the rest of it. */
export function leadOf(answer: Answer): string | undefined {
  const lead = Object.values(answer.spec.elements).find(e => e.type === "AskLead");
  return (lead?.props as { text?: string } | undefined)?.text;
}

/** The answer without its lead, for when the lead is said above it; undefined when the lead was all of it. */
export function withoutLead(answer: Answer): Answer | undefined {
  const { root, elements } = answer.spec, top = elements[root];
  const children = top?.children?.filter(id => elements[id]?.type !== "AskLead") ?? [];
  if (!top || !children.length) return undefined;
  const kept = Object.fromEntries(Object.entries(elements).filter(([, e]) => e.type !== "AskLead"));
  return { ...answer, spec: { ...answer.spec, elements: { ...kept, [root]: { ...top, children } } } };
}

/**
 * A typed or spoken question matched to this page's answers by its words; undefined when none fits. A bare "who" counts
 * only when nothing more telling does, so "Who can go home soonest?" finds the ward's answer, not who needs you.
 */
export function matchQuestion(text: string, answers: Answer[]): Answer | undefined {
  const t = text.toLowerCase();
  const words: Record<string, RegExp> = { needs: /need|urgent|attention|first|who/, overdue: /overdue|late|due|task/, soonest: /home|discharge|free|bed|soon/, watch: /watch|handover|hand over|sick|worr/,
    waiting: /wait|longest|reply|message|who/, money: /money|risk|\brm\b|most|quer/, export: /export|block|dataset|review|approv/, signing: /sign|left|review|ready|plan|missing/, checking: /check|unsure|left|missing|word|tick/ };
  const fits = (q: string) => answers.find(a => words[a.id]?.test(q));
  return fits(t.replace(/\bwho\b/g, "")) ?? fits(t);
}

/**
 * What the page already shows, for a free question (ask.free): each answer's question and lead, and its
 * rows (one per id), which carry the only ids and ops a model's answer may reuse. Within the server's limits.
 */
export function askContext(answers: Answer[]): { lines: string[]; rows: Row[] } {
  const lines: string[] = [], rows = new Map<string, Row>();
  for (const a of answers) for (const e of Object.values(a.spec.elements)) {
    if (e.type === "AskLead") lines.push(clip(`${a.question} ${(e.props as { text: string }).text}`, 300));
    if (e.type === "AskRows") for (const r of (e.props as { rows: Row[] }).rows) if (!rows.has(r.id)) rows.set(r.id, r);
  }
  return { lines: lines.slice(0, 20), rows: [...rows.values()].slice(0, 40) };
}

/**
 * A review page's decision: what still blocks it, each with what it needs, or that nothing does. The
 * checks are the page's own (`dischargeChecks`, `claimChecks`), so the answer never disagrees with the card.
 */
export function blocking(id: "discharge" | "claim", question: string, what: string, checks: { id: string; label: string; status: "passed" | "blocked"; detail: string }[]): Answer {
  const blocked = checks.filter(c => c.status === "blocked"), passed = checks.length - blocked.length;
  return { id, question, worth: blocked.length > 0, spec: column(id, [
    { type: "AskLead", props: { text: blocked.length ? `${plural(blocked.length, "thing")} left before ${what}; ${passed} of ${checks.length} checks passed.` : `Nothing is blocking: ${checks.length === 1 ? "the one check" : `all ${checks.length} checks`} passed.` } },
    { type: "AskRows", props: { rows: blocked.map(c => ({ id: c.id, title: c.label, detail: c.detail, tone: "soon" as const })) } },
  ]) };
}

/** X-ray: findings beyond the question asked that still need a decision (open), and those being tracked. */
export function toFollowUp(findings: { id: string; label: string; status: "open" | "tracked" | "dismissed" }[]): Answer {
  const open = findings.filter(f => f.status === "open"), tracked = findings.filter(f => f.status === "tracked");
  return { id: "findings", question: "What needs following up?", worth: open.length > 0, spec: column("findings", [
    { type: "AskLead", props: { text: open.length ? `${plural(open.length, "finding")} still ${open.length === 1 ? "needs" : "need"} a decision: track or dismiss ${open.length === 1 ? "it" : "each"}.` : tracked.length ? `All findings are decided; ${tracked.length} being tracked.` : "No findings beyond the question asked." } },
    { type: "AskRows", props: { rows: [...open.map(f => ({ id: f.id, title: f.label, detail: "Unvalidated · no decision yet", tone: "soon" as const })), ...tracked.map(f => ({ id: f.id, title: f.label, detail: "Tracked as a follow-up", tone: "good" as const }))] } },
  ]) };
}

export type ThreadLine = { patientId: string; name: string; bed?: string | null; label: "urgent" | "clinical" | "admin" | null; reason?: string | null; waitingSince?: Date | string | null; handled?: boolean };
/** Messages: who is waiting for a reply, urgent first, then the longest wait; each row opens the thread. */
export function waitingLongest(threads: ThreadLine[], now: Date | string): Answer {
  const since = (t: ThreadLine) => t.waitingSince ? new Date(t.waitingSince).getTime() : Infinity;
  const open = threads.filter(t => !t.handled).sort((a, b) => Number(b.label === "urgent") - Number(a.label === "urgent") || since(a) - since(b));
  const urgent = open.filter(t => t.label === "urgent").length;
  return { id: "waiting", question: "Who's waiting longest?", worth: open.length > 0, spec: column("waiting", [
    { type: "AskLead", props: { text: open.length ? `${plural(open.length, "patient")} waiting for a reply${urgent ? `, ${urgent} urgent` : ""}; urgent first, then the longest wait.` : "Nobody is waiting for a reply." } },
    { type: "AskRows", props: { rows: open.slice(0, 12).map(t => ({ id: t.patientId, title: clip(`${t.name}${t.bed ? ` · ${t.bed}` : ""}`, 120),
      detail: clip([t.label === "urgent" ? "Urgent" : t.label === "admin" ? "Admin" : "Clinical", t.label === "urgent" ? t.reason : "", t.waitingSince ? `waiting ${waited(t.waitingSince, now)}` : ""].filter(Boolean).join(" · "), 160),
      tone: t.label === "urgent" ? "urgent" as const : t.label === "admin" ? "calm" as const : "soon" as const, op: `go:/inbox/${t.patientId}` })) } },
  ]) };
}

export type AuditLine = { id: string; patient: string; bed: string; doctor: string; gap: string; risk: number };
/** Coding audit: the queries holding the most money, each opening its drafted query; once every query is out, the next step. */
export function mostMoney(items: AuditLine[], sent: number): Answer {
  const ranked = [...items].sort((a, b) => b.risk - a.risk), top = ranked.slice(0, 3);
  const total = ranked.reduce((n, i) => n + i.risk, 0);
  return { id: "money", question: "Which queries hold the most money?", worth: ranked.length > 0, spec: column("money", [
    { type: "AskLead", props: { text: ranked.length ? `${formatRM(total)} at risk across ${plural(ranked.length, "note")}; the top ${top.length === 1 ? "one holds" : `${top.length} hold`} ${formatRM(top.reduce((n, i) => n + i.risk, 0))}.` : `Every query is out${sent ? ` (${sent} sent)` : ""}; nothing is left at risk.` } },
    { type: "AskRows", props: { rows: ranked.slice(0, 12).map(i => ({ id: i.id, title: clip([i.patient, i.bed].filter(Boolean).join(" · "), 120), detail: clip(`${formatRM(i.risk)} · ${i.gap} · ${i.doctor}`, 160), tone: "soon" as const, op: `tab:${i.id}` })) } },
    ...(ranked.length ? [] : [{ type: "AskActions" as const, props: { items: [{ label: AUDIT_NEXT.label, op: AUDIT_NEXT.op, primary: true }] } }]),
  ]) };
}
/** Once every query is out, the next place to act: the ward, where the blocked beds are. */
export const AUDIT_NEXT = { label: "Open the ward", op: "go:/ward" };

export type SampleLine = { id: string; title: string; status: "pending" | "blocked"; leak?: string };
/**
 * Training data: what stands between the queue and the next export. Only approved rows export, so
 * nothing else blocks it once one is approved; samples the leak check blocked never export and wait to be excluded.
 */
export function exportBlockers({ ready, next }: { ready: number; next: number }, samples: SampleLine[]): Answer {
  const blocked = samples.filter(s => s.status === "blocked"), pending = samples.filter(s => s.status === "pending");
  const lead = ready ? `Nothing is blocking: ${plural(ready, "approved row")} will export as v${next}${pending.length ? `; ${pending.length} more waiting for review` : ""}.`
    : pending.length ? `v${next} needs approved rows: ${plural(pending.length, "sample")} ${pending.length === 1 ? "is" : "are"} waiting for review.`
    : "Nothing to export: no sample is waiting for review.";
  return { id: "export", question: "What's blocking the next export?", worth: !ready && samples.length > 0, spec: column("export", [
    { type: "AskLead", props: { text: blocked.length ? `${lead} ${plural(blocked.length, "sample")} blocked by the leak check can't export.` : lead } },
    { type: "AskRows", props: { rows: [...blocked, ...pending].slice(0, 12).map(s => ({ id: s.id, title: clip(s.title, 120), detail: s.status === "blocked" ? clip(`${s.leak ?? "Blocked by leak check"} · exclude it`, 160) : "Waiting for review · approve or exclude", tone: s.status === "blocked" ? "urgent" as const : "soon" as const })) } },
  ]) };
}

export type NoteState = { drafted: boolean; saved: boolean; reviewed: boolean; empty: string[]; unsureLines: number; fromSample: boolean; plan: string; openTasks: number };
const planSteps = (plan: string) => plan.split(/[\n;]|\.\s/).filter(line => line.trim()).length;
/** The visit's next step once the note is saved: the plan's steps as tasks when the visit has none open, else hand over. */
export function noteNext(note: Pick<NoteState, "saved" | "plan" | "openTasks">): { label: string; op: string } | undefined {
  if (!note.saved) return undefined;
  const steps = planSteps(note.plan);
  return steps && !note.openTasks ? { label: `Add the plan's ${plural(steps, "step")} as tasks`, op: "go:/tasks" } : { label: "Hand over", op: "go:/handover" };
}
/** Note: what is left before it is signed off (marked reviewed), from the page's own state, then the visit's next step. */
export function beforeSigning(note: NoteState): Answer {
  const left: Row[] = !note.drafted ? [{ id: "draft", title: "Nothing drafted yet", detail: "Draft from the consultation, then write your assessment and plan", tone: "soon" }] : [
    ...note.empty.map(name => ({ id: `empty-${name}`, title: `${name} is empty`, detail: /assessment|plan/i.test(name) ? "Yours to write; Sona leaves it empty" : "Nothing captured yet", tone: "soon" as const })),
    ...(note.unsureLines ? [{ id: "unsure", title: `${plural(note.unsureLines, "unsure line")} in the transcript`, detail: "Interpretations not yet checked against the original dialogue", tone: "soon" as const }] : []),
    ...(note.fromSample && !note.reviewed ? [{ id: "sample", title: "Drafted from the sample consultation", detail: "Check every line before marking it reviewed", tone: "soon" as const }] : []),
    ...(!note.saved ? [{ id: "save", title: "Not saved", detail: "Save the draft before marking it reviewed", tone: "soon" as const }]
      : !note.reviewed ? [{ id: "review", title: "Not marked reviewed", detail: "Mark it reviewed once you've checked it", tone: "calm" as const }] : []),
  ];
  const next = noteNext(note);
  return { id: "signing", question: "What's left before signing?", worth: left.length > 0, spec: column("signing", [
    { type: "AskLead", props: { text: left.length ? `${plural(left.length, "thing")} left before signing.` : "Nothing left: the note is reviewed." } },
    { type: "AskRows", props: { rows: left } },
    ...(next ? [{ type: "AskActions" as const, props: { items: [{ label: next.label, op: next.op, primary: !left.length }] } }] : []),
  ]) };
}

/** Scan: what still needs a look before it reaches the record (unsure words, medicines read with low confidence), and what is unticked, so left out. */
export function toCheck({ unsure, low, off }: { unsure: string[]; low: { id: string; label: string }[]; off: { id: string; label: string }[] }): Answer {
  const n = unsure.length + low.length;
  return { id: "checking", question: "What still needs checking?", worth: n + off.length > 0, spec: column("checking", [
    { type: "AskLead", props: { text: n ? `${plural(n, "thing")} to check before adding to the record${off.length ? `; ${off.length} unticked won't be added` : ""}.` : off.length ? `Nothing unsure; ${plural(off.length, "item")} unticked won't be added.` : "Nothing left to check: every item is ticked and read clearly." } },
    { type: "AskRows", props: { rows: [
      ...unsure.map(w => ({ id: `word-${w}`.slice(0, 64), title: clip(`“${w}”`, 120), detail: "Handwriting unclear · compare with the photo, then keep or correct it", tone: "soon" as const })),
      ...low.map(m => ({ id: m.id, title: clip(m.label, 120), detail: "Read with low confidence · check the photo", tone: "soon" as const })),
      ...off.map(o => ({ id: o.id, title: clip(o.label, 120), detail: "Unticked · won't be added", tone: "calm" as const })),
    ].slice(0, 12) } },
  ]) };
}
