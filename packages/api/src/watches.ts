import { encounters, hospitalMembers, patients, tasks } from "@sona-ai/db/schema/clinical";
import { lastDue, nextDue } from "@sona-ai/domain/watch";
import { and, desc, eq } from "drizzle-orm";

import { recordAccess } from "./access";
import { freeAnswer } from "./ask-model";
import type { AskContext } from "./ask-spec";
import { clockOffsetOf } from "./clock";
import { clockOf, type Context } from "./context";
import { listResults } from "./routers/day";

/**
 * Watches: a clinician's own standing questions, each asked once a day at its hour by that clinician's
 * watch agent (apps/server/src/agents/watch.ts keeps the book and the alarm; tests keep it in memory).
 *
 * A watch only reads and reports. It answers through ask.free's own path (freeAnswer), so the answer is
 * the same checked spec the ask bar shows: rows copied from the hospital's data, a lead that names
 * nothing the data lacks. It has no write route, so it can never prescribe, send or change anything.
 */
export type WatchAnswer = { at: string; /** The model was starting and the one retry failed too. */ retried?: true } & Awaited<ReturnType<typeof freeAnswer>>;
export type Watch = { id: string; question: string; /** 0–23, the hospital's time. */ hour: number; createdAt: string; last: WatchAnswer | null };
/** A watch agent's own state: whose watches these are, and each one's latest answer. */
export type WatchBook = { hospitalId: string; userId: string; watches: Watch[] };

/** The clinicians' watch agents, by user (the Worker's Durable Objects; tests run them in memory). */
export type Watches = {
  list(hospitalId: string, userId: string): Promise<Watch[]>;
  /** Keeps the watch and asks it once now, so its first answer shows at once; replaying the same id returns the kept one. */
  add(hospitalId: string, userId: string, watch: Pick<Watch, "id" | "question" | "hour">): Promise<Watch>;
  remove(hospitalId: string, userId: string, watchId: string): Promise<void>;
  /** Asks whatever is due by the hospital's clock. */
  tick(hospitalId: string, userId: string): Promise<{ ran: number }>;
};

type Deps = Pick<Context, "db" | "baseten" | "announce" | "now">;

/** A model that was starting is asked once more, this long after. */
const RETRY_MS = 5 * 60_000;
const awaitsRetry = (w: Watch, now: Date) => w.last?.source === "fixture" && !("unanswered" in w.last) && !w.last.retried && w.last.at >= lastDue(w.hour, now).toISOString();
const isDue = (w: Watch, now: Date, hosted: boolean) => (w.last?.at ?? w.createdAt) < lastDue(w.hour, now).toISOString() || (hosted && awaitsRetry(w, now));

/**
 * What a watch may answer from: the hospital's lab results and open tasks, as ask rows.
 * ponytail: the newest 28 results and 12 tasks, hospital-wide (ask.free takes 40 rows; the record has no "my patients" yet).
 */
export async function watchData(db: Context["db"], hospitalId: string): Promise<AskContext> {
  const results = (await listResults(db, hospitalId)).filter(r => r.flag !== "pending").slice(0, 28);
  const open = await db.select({ id: tasks.id, title: tasks.title, owner: tasks.owner, due: tasks.due, patientId: patients.id, patientName: patients.name }).from(tasks)
    .leftJoin(encounters, eq(encounters.id, tasks.encounterId)).leftJoin(patients, eq(patients.id, encounters.patientId))
    .where(and(eq(tasks.hospitalId, hospitalId), eq(tasks.completed, false))).orderBy(desc(tasks.createdAt)).limit(12);
  return {
    lines: [
      `${results.length} lab results, ${results.filter(r => !r.acknowledgedAt).length} not yet acknowledged.`,
      `${open.length} open tasks.`,
    ],
    rows: [
      ...results.map(r => ({
        id: r.id, title: r.patientName.slice(0, 120),
        detail: [`${r.test} ${r.value}${r.unit ? ` ${r.unit}` : ""}`, r.flag, r.acknowledgedAt ? undefined : "not yet acknowledged"].filter(Boolean).join(" · ").slice(0, 160),
        tone: r.critical ? "urgent" as const : r.flag ? "soon" as const : "calm" as const, op: `open:${r.patientId}`,
      })),
      ...open.map(t => ({
        id: t.id, title: t.title.slice(0, 120), detail: [t.patientName, t.owner, t.due && `due ${t.due}`].filter(Boolean).join(" · ").slice(0, 160),
        tone: "calm" as const, ...(t.patientId ? { op: `open:${t.patientId}` } : {}),
      })),
    ],
  };
}

/** The patients an answer names (its rows open their records), for the access trail. */
function patientsIn(answer: Awaited<ReturnType<typeof freeAnswer>>) {
  if (answer.source !== "model") return [];
  const rows = Object.values(answer.spec.elements).flatMap(e => e.type === "AskRows" ? e.props.rows as { op?: string }[] : []);
  return [...new Set(rows.flatMap(r => r.op?.startsWith("open:") ? [r.op.slice(5)] : []))];
}

/**
 * One wake: asks every due watch (and `only`, when given, whether due or not), from the same read of the
 * hospital's data. `wakeAt` is real time, so the agent's alarm is right while the demo clock is moved.
 */
export async function runWatches(deps: Deps, book: WatchBook, only?: string) {
  const { db, baseten } = deps;
  const offset = await clockOffsetOf(db, book.hospitalId);
  const now = new Date(clockOf(deps).getTime() + offset);
  let data: AskContext | undefined, ran = 0;
  const watches: Watch[] = [];
  for (const w of book.watches) {
    if (w.id !== only && !isDue(w, now, Boolean(baseten))) { watches.push(w); continue; }
    data ??= await watchData(db, book.hospitalId);
    const answer = baseten ? await freeAnswer(baseten, { scope: "watch", question: w.question, context: data }) : { source: "fixture" as const };
    const retried = answer.source === "fixture" && awaitsRetry(w, now);
    watches.push({ ...w, last: { at: now.toISOString(), ...answer, ...(retried ? { retried: true as const } : {}) } });
    ran++;
    // PDPA access trail: Sona showed this clinician these patients' results or tasks.
    for (const patientId of patientsIn(answer)) await recordAccess({ db, now: () => now }, book.hospitalId, book.userId, "watches.run", { patientId }).catch(error => console.error("access log failed", error));
  }
  if (ran) await deps.announce?.(book.hospitalId, { topic: "watches" }).catch(() => {});
  const next = watches.map(w => baseten && awaitsRetry(w, now) ? now.getTime() + RETRY_MS : nextDue(w.hour, now).getTime());
  return { book: { ...book, watches }, ran, wakeAt: next.length ? new Date(Math.min(...next) - offset) : undefined };
}

/**
 * One clinician's watches over a store (the agent's state, or a test's map): each step saves the book and
 * says when to wake next. The agent is named by the user, so a book kept for anyone else is refused.
 */
export function watchKeeper(deps: Deps, store: { get(): WatchBook | null; set(book: WatchBook): void }, hospitalId: string, userId: string) {
  const book = (): WatchBook => {
    const kept = store.get();
    if (kept && (kept.hospitalId !== hospitalId || kept.userId !== userId)) throw new Error("These watches belong to someone else");
    return kept ?? { hospitalId, userId, watches: [] };
  };
  const run = async (from: WatchBook, only?: string) => {
    const done = await runWatches(deps, from, only);
    store.set(done.book);
    return done;
  };
  return {
    list: () => book().watches,
    async add(input: Pick<Watch, "id" | "question" | "hour">) {
      const kept = book(), had = kept.watches.some(w => w.id === input.id);
      const created = new Date(clockOf(deps).getTime() + await clockOffsetOf(deps.db, hospitalId)).toISOString();
      const done = await run(had ? kept : { ...kept, watches: [...kept.watches, { ...input, createdAt: created, last: null }] }, had ? undefined : input.id);
      return { watch: done.book.watches.find(w => w.id === input.id)!, wakeAt: done.wakeAt };
    },
    async remove(watchId: string) {
      const kept = book();
      return { wakeAt: (await run({ ...kept, watches: kept.watches.filter(w => w.id !== watchId) })).wakeAt };
    },
    tick: async () => { const { ran, wakeAt } = await run(book()); return { ran, wakeAt }; },
  };
}

/**
 * A demo jump: every clinician's watch agent wakes, so what the new time makes due is asked within seconds.
 * ponytail: wakes every member's agent, watches or not; fine for the demo hospital, the only one with a clock to move.
 */
export async function wakeWatches(context: Pick<Context, "db" | "watches">, hospitalId: string) {
  const { db, watches } = context;
  if (!watches) return { ran: 0 };
  const members = await db.select({ userId: hospitalMembers.userId }).from(hospitalMembers).where(eq(hospitalMembers.hospitalId, hospitalId));
  const woken = await Promise.all(members.map(m => watches.tick(hospitalId, m.userId).catch(error => { console.error("watch agent failed", m.userId, error); return { ran: 0 }; })));
  return { ran: woken.reduce((n, w) => n + w.ran, 0) };
}
