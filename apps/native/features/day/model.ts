import { testInSentence } from "@sona-ai/domain/handover";
import { SUGGESTED, bedKind, type Bed, type Owner } from "@sona-ai/domain/ward";
import { demoTime } from "@/features/encounter/fixtures";
import type { Encounter, Patient } from "@/features/encounter/types";

/**
 * Today's items from outside the record (Sona Care's check-ins, messages and booking requests), each scored for the one
 * ranking (`needsYou` in ./counts, with the record's flags), and every one stating why it is there.
 *
 * ponytail: urgency is a transparent rule score over synthetic fixtures. A model-ranked list replaces `score` when the
 * backend exists; the reason line stays mandatory so a ranking is never unexplained.
 */
// Under a minute reads as just now, never "0 min".
const waitedLine = (waited: string) => /^0\b/.test(waited) ? "Urgent message · just now" : `Urgent message · no reply for ${waited}`;

export type DayTone = "urgent" | "soon" | "routine";
export type DayItem = {
  id: string; kind: "result" | "blocker" | "visit" | "task" | "check-in" | "booking" | "message" | "claim"; title: string; detail: string; reason: string; tone: DayTone; score: number;
  /** When it happened (ms), for items that tie on score: the newer one leads. */
  at?: number;
  patientId?: string; open: { next?: string; view?: string };
};

/** The ranking rule: higher score first; on a tie the newer event leads (undated items keep their order after dated ones). */
export const byUrgency = (a: Pick<DayItem, "score" | "at">, b: Pick<DayItem, "score" | "at">) => b.score - a.score || (b.at ?? 0) - (a.at ?? 0);

// A synthetic lab result that arrived after Daniel's intake and has not been acted on.
// `last`: the same test's previous value for this patient, when there is one ("3.8 on 14 Sep").
export type PendingResult = { id?: string; patientId: string; test: string; value: string; flag: string; receivedAt: string; last?: string };
export const PENDING_RESULT: PendingResult = { patientId: "SYN-1086", test: "Potassium", value: "3.1 mmol/L", flag: "Low", receivedAt: demoTime(-120), last: "3.8 on 14 Sep" };
/** Keeps the demo result about two hours old when the demo schedule is refreshed. */
export { testInSentence };
export function refreshPendingResult(now = new Date()) { PENDING_RESULT.receivedAt = demoTime(-120, now); }

const minutes = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h! * 60 + m!; };
const ago = (from: number, now: number) => { const d = Math.max(0, now - from); return d < 60 ? `${d} min` : `${Math.floor(d / 60)} h`; };
/** How long a result has waited, at `now` (minutes into the day): "2 h", "25 min". */
export const resultAge = (result: Pick<PendingResult, "receivedAt">, now: number) => ago(minutes(result.receivedAt), now);

/**
 * Two stores' visits read the same for the home keys: what homeActions reads of each, whether it has
 * started, its medicines and its tasks. Today sits under an open visit and re-rendered on each of its writes (an answer
 * streaming in writes 4 times); read through this, only when one of these changes. A new read of a visit there joins it here.
 */
export const sameForToday = (a: Record<string, Encounter | undefined>, b: Record<string, Encounter | undefined>) =>
  Object.keys(a).length === Object.keys(b).length
  && Object.keys(b).every(id => a[id]?.requests.length === b[id]?.requests.length && a[id]?.medicationEntries === b[id]?.medicationEntries && a[id]?.tasks === b[id]?.tasks);

/** A patient's booking request from Sona Care, as the server lists it (see bookings.list). */
export type BookingRequest = { id: string; patientId: string; doctorName: string; specialty: string; title: string | null; reason: string | null; createdAt: Date | string };

/**
 * Sona Care booking requests waiting for the care team: amber rows ("Amelia asks to see Dr. Lim ·
 * Thu 10:30") that rank above blockers but below a patient getting worse at home; the row's ID carries
 * the request's, so Confirm and Decline act on it in place. `now` is on the demo clock, which stamps the request.
 */
export function bookingItems(requests: BookingRequest[], now: Date): DayItem[] {
  return requests.map(r => ({
    id: `booking-${r.id}`, kind: "booking" as const, title: r.title ?? `Booking request · ${r.doctorName}`, detail: r.reason ? `“${r.reason}” · ${r.specialty}` : `${r.doctorName} · ${r.specialty}`,
    reason: `Asked in Sona Care ${since(r.createdAt, now)} ago · confirm or decline`, tone: "soon" as const, score: 75, patientId: r.patientId, open: {},
  }));
}

/** "25 min", "2 h", "3 d" from a moment to now. */
function since(at: Date | string, now: Date) {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(at).getTime()) / 60_000));
  return mins < 60 ? `${mins} min` : mins < 1440 ? `${Math.floor(mins / 60)} h` : `${Math.floor(mins / 1440)} d`;
}

/** A patient's thread as the care inbox lists it (see messages.inbox). */
export type MessageThread = { patientId: string; name: string; label: "urgent" | "clinical" | "admin" | null; reason: string | null; lastText: string; lastAt: Date | string; waitingSince: Date | string | null; handled: boolean };
const WORDS = 6;

/**
 * An urgent Sona Care message nobody has answered: a red row titled with the patient's own first
 * words ("Amelia: sesak nafas bila jalan sikit"), the triage's reason beneath. It scores level with a
 * patient reported worse after discharge (105), so between those two the newer leads (byUrgency);
 * an urgent check-in reply (120) still comes first, and it outranks an unacknowledged result (100).
 */
export function messageItems(threads: MessageThread[], now = new Date()): DayItem[] {
  return threads.filter(t => !t.handled && t.label === "urgent").map(t => {
    const words = t.lastText.trim().split(/\s+/);
    return {
      id: `message-${t.patientId}`, kind: "message" as const, title: `${t.name.split(" ")[0]}: ${words.slice(0, WORDS).join(" ")}${words.length > WORDS ? "…" : ""}`,
      detail: t.reason ?? "Triaged urgent", reason: waitedLine(since(t.waitingSince ?? t.lastAt, now)), tone: "urgent" as const, score: 105, at: new Date(t.lastAt).getTime(), patientId: t.patientId, open: { view: "messages" },
    };
  });
}

/**
 * Visits whose pins would overlap on the ruler share one pin. A visit joins the current group when
 * it starts before that group's pin ends; `span` gives a group's pin width in minutes (it grows
 * with the group, so a wide "4 patients" pin also absorbs a visit a little later).
 */
export function groupVisits<T extends { at: number }>(visits: T[], span: (group: T[]) => number): T[][] {
  const groups: T[][] = [];
  for (const visit of [...visits].sort((a, b) => a.at - b.at)) {
    const last = groups.at(-1);
    if (last && visit.at < last[0]!.at + span(last)) last.push(visit); else groups.push([visit]);
  }
  return groups;
}

/**
 * Other days (a week around today). Today uses the live visits; the rest is an authored synthetic
 * clinic list, so a doctor can look back at completed visits and ahead at what to prepare.
 * Weekends are empty. ponytail: fixed demo schedule; the hospital scheduling feed replaces it.
 */
export type ScheduleVisit = { id: string; name: string; initials: string; time: string; reason: string; incomplete: boolean; patientId?: string };
const OTHER: [string, string, string, boolean][] = [
  ["Siti Aminah", "SA", "Diabetes review", false], ["Lim Wei Jie", "LW", "Post-op check", false], ["Ravi Kumar", "RK", "Heart failure follow-up", true],
  ["Nur Aisyah", "NA", "Asthma action plan", false], ["Tan Mei Ling", "TM", "Blood pressure review", false], ["Arjun Pillai", "AP", "New referral · history to take", true],
];
export function dayOf(offset: number, today: Date) { const d = new Date(today); d.setDate(d.getDate() + offset); return d; }
export function scheduleFor(offset: number, patients: Patient[], today: Date): ScheduleVisit[] {
  if (offset === 0) return patients.map(p => ({ id: p.id, name: p.name, initials: p.initials, time: p.time, reason: p.subtitle, incomplete: p.incomplete, patientId: p.id }));
  const day = dayOf(offset, today).getDay();
  if (day === 0 || day === 6) return [];
  const mod = (n: number, k: number) => ((n % k) + k) % k;
  const count = 2 + mod(offset, 3);
  return Array.from({ length: count }, (_, i) => {
    const [name, initials, reason, incomplete] = OTHER[mod(i + offset, OTHER.length)]!;
    const m = 9 * 60 + i * 75 + mod(offset, 2) * 30;
    return { id: `d${offset}-${i}`, name, initials, reason, incomplete, time: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` };
  });
}
/** What each home key opens, as a permission: a key whose page the role can't read is hidden, not left to refuse (a bed manager keeps the Ward). */
const NEEDS: Record<string, string> = { patients: "encounter.get", results: "results.list", handover: "handover.list", messages: "messages.inbox" };
export const usableKeys = <T extends { key: string }>(actions: T[], can: (path: string) => boolean) => actions.filter(a => !NEEDS[a.key] || can(NEEDS[a.key]!));

/** Blocker owners saved on the server: each is a "blocker-owner" task whose source is the blocker. */
export const ownersOf = (tasks: { kind?: string | null; sourceId?: string | null; owner: string }[]): Record<string, string> =>
  Object.fromEntries(tasks.filter(t => t.kind === "blocker-owner" && t.sourceId).map(t => [t.sourceId!, t.owner]));

/**
 * A bed manager's Today after the ward line: the blocked discharges with a blocker nobody owns yet, each
 * with the team suggested for it, most bed-hours waiting first. Clinical rows (results, visits, medicines)
 * are not theirs to open, so they are never listed.
 */
export type Unowned = { bed: string; name: string; hours: number; blockers: { id: string; label: string; suggested: Owner }[] };
export function unownedBlocked(beds: Bed[], owners: Record<string, string | undefined>): Unowned[] {
  return beds.filter(b => bedKind(b) === "blocked").flatMap(b => {
    const open = b.blockers.filter(x => !owners[x.id]);
    return open.length ? [{ bed: b.bed, name: b.name!, hours: b.waitingHours ?? 0, blockers: open.map(x => ({ id: x.id, label: x.label, suggested: SUGGESTED[x.kind] })) }] : [];
  }).sort((a, b) => b.hours - a.hours);
}
