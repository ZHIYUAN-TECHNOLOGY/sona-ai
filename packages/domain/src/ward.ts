import type { ClaimStatus } from "./claim";
import { EMPTY_DISCHARGE } from "./discharge";
import type { Encounter, Patient } from "./types";

/**
 * The ward at a glance for the charge nurse or bed manager: every bed, who is fit to go, what is
 * holding each discharge, and who owns each blocker. Bed 6 is the demo patient and reads the live
 * discharge and guarantee-letter state, so resolving it in flows 1 and 2 clears it here. In live
 * mode every bed comes from the server instead (admittedBed, with blockers from bedBlockers).
 *
 * ponytail: authored ward (the fixture, and the seed's `record.ward`); bed data and predicted
 * discharge times come from the bed system later. Owners are the four teams that clear most discharge blockers.
 */
export type Owner = "Pharmacy" | "Billing" | "Porter" | "Nurse";
export type BlockerKind = "gl" | "pharmacy" | "transport" | "result" | "booking";
export type WardBlocker = { id: string; kind: BlockerKind; label: string; detail: string };
export type Bed = {
  bed: string; patientId?: string; name?: string; initials?: string; meta?: string;
  status: "fit" | "watch" | "stable" | "empty" | "free"; predicted: string; waitingHours?: number;
  sbar?: { s: string; b: string; a: string; r: string }; blockers: WardBlocker[];
};

export const OWNERS: Owner[] = ["Pharmacy", "Billing", "Porter", "Nurse"];
export const SUGGESTED: Record<BlockerKind, Owner> = { gl: "Billing", pharmacy: "Pharmacy", transport: "Porter", result: "Nurse", booking: "Nurse" };
export const DEMO_PATIENT = "SYN-1042";

/** The authored ward around bed 6 (fixture mode); the seed writes the same beds as rows for live mode. */
export const WARD_FIXTURE: Bed[] = [
  { bed: "Bed 2", name: "Nurul Huda", initials: "NH", meta: "29 · Female", status: "fit", predicted: "11:00", waitingHours: 5,
    sbar: { s: "Day 3 of antibiotics for pyelonephritis.", b: "No significant history.", a: "Afebrile 36 h, eating and walking.", r: "Discharge once the final GL and sensitivities are in." },
    blockers: [{ id: "b2-gl", kind: "gl", label: "Final guarantee letter", detail: "Synthetic TPA · requested 08:10" }, { id: "b2-result", kind: "result", label: "Urine culture sensitivities", detail: "Lab expects by 12:00" }] },
  { bed: "Bed 14", name: "Lim Wei Jie", initials: "LW", meta: "34 · Male", status: "fit", predicted: "14:30", waitingHours: 3,
    sbar: { s: "Post-op day 1, laparoscopic appendicectomy.", b: "No significant history.", a: "Pain controlled, eating, mobilising.", r: "Discharge today once take-home analgesia and a ride are sorted." },
    blockers: [{ id: "b14-pharm", kind: "pharmacy", label: "Take-home analgesia", detail: "Not yet dispensed" }, { id: "b14-ride", kind: "transport", label: "Ride home", detail: "Family free after 17:00" }] },
  { bed: "Bed 8", name: "Priya Nair", initials: "PN", meta: "45 · Female", status: "fit", predicted: "13:00", waitingHours: 1,
    sbar: { s: "Day 4, cellulitis of the left leg.", b: "Type 2 diabetes.", a: "Redness receding, afebrile.", r: "Discharge on oral antibiotics; wound clinic in a week." }, blockers: [] },
  { bed: "Bed 12", name: "Siti Aminah", initials: "SA", meta: "68 · Female", status: "watch", predicted: "Tomorrow",
    sbar: { s: "Day 2 of IV antibiotics for pneumonia.", b: "Type 2 diabetes.", a: "Afebrile since 06:00, oxygen weaned to 2 L.", r: "Review oral switch on the morning round." }, blockers: [] },
  { bed: "Bed 9", name: "Ravi Kumar", initials: "RK", meta: "71 · Male", status: "watch", predicted: "In 2 days",
    sbar: { s: "Heart failure exacerbation.", b: "Chronic kidney disease stage 3.", a: "Weight down 1.2 kg on furosemide.", r: "Repeat renal function at 06:00." },
    blockers: [{ id: "b9-renal", kind: "result", label: "Renal function", detail: "Due 06:00" }] },
  { bed: "Bed 4", name: "Tan Ah Kow", initials: "TK", meta: "76 · Male", status: "stable", predicted: "Awaiting rehab",
    sbar: { s: "Stroke, day 9, medically stable.", b: "Hypertension, atrial fibrillation.", a: "Needs inpatient rehabilitation.", r: "Transfer when a rehab bed opens." },
    blockers: [{ id: "b4-transfer", kind: "transport", label: "Transfer to rehab centre", detail: "Waiting for a bed" }] },
  { bed: "Bed 10", status: "empty", predicted: "Cleaning · ready 12:30", blockers: [] },
];

/** What the bed system would say about an admitted patient; the server keeps it in `patients.record.ward`. No `predicted`: once cleared. */
export type WardRecord = { status: "fit" | "watch" | "stable"; predicted?: string; waitingHours?: number; sbar?: Bed["sbar"] };
export const DEMO_WARD: WardRecord = {
  status: "fit", waitingHours: 1,
  sbar: { s: "Community-acquired pneumonia, mild, day 2.", b: "Asthma. Penicillin allergy reported.", a: "Afebrile 18 h, SpO₂ 97% on room air.", r: "Discharge today on oral azithromycin." },
};

/** The demo patient's bed, built from the live discharge and guarantee-letter state. */
function demoBed(patient: Patient | undefined, encounter: Encounter | undefined): Bed {
  const d = encounter?.discharge ?? EMPTY_DISCHARGE;
  if (d.dischargedAt) return freedBed("Bed 6");
  const blockers: WardBlocker[] = [];
  if (!d.glReceived) blockers.push({ id: "b6-gl", kind: "gl", label: "Final guarantee letter", detail: glDetail(encounter?.claim?.status) });
  if (!d.medsConfirmed) blockers.push({ id: "b6-meds", kind: "pharmacy", label: "Take-home medicines", detail: "1 changed · 1 new · 1 stopped" });
  if (!d.followUp) blockers.push({ id: "b6-followup", kind: "booking", label: "Follow-up booking", detail: "Clinic review, about 2 weeks" });
  return {
    bed: "Bed 6", patientId: DEMO_PATIENT, name: patient?.name ?? "Amelia Tan", initials: patient?.initials ?? "AT", meta: patient ? `${patient.age} · ${patient.sex}` : undefined,
    status: "fit", predicted: blockers.length ? "Once cleared" : "Now", waitingHours: DEMO_WARD.waitingHours, sbar: DEMO_WARD.sbar, blockers,
  };
}

/** The guarantee-letter blocker's line: where the letter stands with the insurer. */
export const GL_DENIED = "Denied, appeal drafted";
export const glDetail = (claim?: ClaimStatus) => claim === "sent" ? "Sent · awaiting insurer" : claim === "queried" ? "Insurer asked a question"
  : claim === "denied" ? GL_DENIED : claim === "appealed" ? "Appeal sent · awaiting insurer" : "Codes ready to review";

/** One admission's rows, flattened: the server's view of what holds a bed. No `gl` means self-pay. */
export type BedRows = {
  admissionId: string; gl?: { status: "requested" | "received"; claimStatus?: ClaimStatus };
  medsConfirmed: boolean; followUpBooked: boolean; pendingResults: { id: string; test: string; expected?: string }[];
  /** Incidental findings nobody has tracked or dismissed yet (demo flow 6). */
  openFindings?: { id: string; label: string }[];
  /** A ride or transfer still to arrange. False `fit`: not yet fit to go, so take-home medicines and follow-up wait. */
  transport?: { label: string; detail: string }; fit?: boolean;
};

/** A bed's blockers derived from rows (the server version of demoBed); ids are stable so owners stick. */
export function bedBlockers(rows: BedRows): WardBlocker[] {
  const id = rows.admissionId, blockers: WardBlocker[] = [];
  if (rows.gl?.status === "requested") blockers.push({ id: `${id}-gl`, kind: "gl", label: "Final guarantee letter", detail: glDetail(rows.gl.claimStatus) });
  const preparing = rows.fit !== false;
  if (preparing && !rows.medsConfirmed) blockers.push({ id: `${id}-meds`, kind: "pharmacy", label: "Take-home medicines", detail: "Not yet confirmed" });
  if (preparing && !rows.followUpBooked) blockers.push({ id: `${id}-followup`, kind: "booking", label: "Follow-up booking", detail: "Clinic review not booked" });
  if (rows.transport) blockers.push({ id: `${id}-transport`, kind: "transport", ...rows.transport });
  for (const r of rows.pendingResults) blockers.push({ id: `${id}-result-${r.id}`, kind: "result", label: r.test, detail: r.expected ? `Expected by ${r.expected}` : "Pending" });
  for (const f of rows.openFindings ?? []) blockers.push({ id: `${id}-finding-${f.id}`, kind: "result", label: f.label, detail: "Unvalidated finding · follow-up not tracked" });
  return blockers;
}

export const freedBed = (bed: string): Bed => ({ bed, status: "free", predicted: "Free · cleaning next", blockers: [] });

/** An admitted patient's bed on the server: their ward record, with blockers derived from rows (see bedBlockers). */
export function admittedBed(bed: string, patient: { id: string; name: string; initials: string; age: number; sex: string }, ward: WardRecord, blockers: WardBlocker[]): Bed {
  return {
    bed, patientId: patient.id, name: patient.name, initials: patient.initials, meta: `${patient.age} · ${patient.sex}`, status: ward.status,
    predicted: ward.predicted ?? (blockers.length ? "Once cleared" : "Now"), waitingHours: ward.waitingHours, sbar: ward.sbar, blockers,
  };
}

// Fit-to-go beds lead, the most blocked first, so the eye lands on what to unblock.
const rank = (b: Bed) => (b.status === "fit" ? 0 : b.status === "watch" ? 1 : b.status === "stable" ? 2 : 3) * 10 - b.blockers.length;
export const byUrgency = (a: Bed, b: Bed) => rank(a) - rank(b);

export function wardBeds(patients: Patient[], encounters: Record<string, Encounter | undefined>): Bed[] {
  const demo = demoBed(patients.find(p => p.id === DEMO_PATIENT), encounters[DEMO_PATIENT]);
  return [demo, ...WARD_FIXTURE].sort(byUrgency);
}

/**
 * A bed's place on the ward: blocked (a patient fit to go, held by something), fit to go, on watch, or the
 * rest. The one rule behind every count and every list of beds (the ward's filter and its rows, the summary,
 * the huddle, Today's keys), so a count can never disagree with the list it opens.
 */
export type BedKind = "blocked" | "fit" | "watch" | "other";
export const bedKind = (b: Pick<Bed, "status" | "name"> & { blockers: unknown[] }): BedKind =>
  b.status === "fit" && b.name ? (b.blockers.length ? "blocked" : "fit") : b.status === "watch" ? "watch" : "other";

export function wardSummary(beds: Bed[]) {
  const blocked = beds.filter(b => bedKind(b) === "blocked");
  const fit = blocked.length + beds.filter(b => bedKind(b) === "fit").length;
  return { beds: beds.length, fit, blocked: blocked.length, bedHours: blocked.reduce((sum, b) => sum + (b.waitingHours ?? 0), 0) };
}

/** Three lines for the huddle: what blocks the most beds, and who owns it. */
export function huddle(beds: Bed[], owners: Record<string, Owner | undefined>): string[] {
  const s = wardSummary(beds);
  const blockedBeds = beds.filter(b => bedKind(b) === "blocked");
  const unowned = blockedBeds.flatMap(b => b.blockers).filter(x => !owners[x.id]).length;
  const top = blockedBeds[0];
  return [
    `${s.fit} fit to go, ${s.blocked} still blocked, about ${s.bedHours} bed-hours waiting.`,
    top ? `Start with ${top.bed}: ${top.blockers.map(x => x.label.toLowerCase()).join(", ")}.` : "No discharge is blocked right now.",
    unowned ? `${unowned} ${unowned === 1 ? "blocker has" : "blockers have"} no owner yet.` : "Every blocker has an owner.",
  ];
}

/*
 * When will beds free up? A rule-based forecast, not a model: each bed's planned out time (or a ready
 * time), pushed back by a fixed delay per open blocker, read on the hospital's (demo) clock.
 * ponytail: flat delays per blocker kind and a fixed Kuala Lumpur clock (UTC+8, no DST); learn the
 * delays from discharge receipts and take the hospital's zone when a second site joins.
 */
export type Confidence = "high" | "medium" | "low";
export type ForecastEntry = { bed: string; name?: string; at: Date; confidence: Confidence; reasons: string[] };
/** The one blocker whose clearing frees the most bed-hours, soonest. `owned` false: `owner` is the suggested team. */
export type Unlock = { bed: string; blockerId: string; label: string; owner: Owner; owned: boolean; hours: number; line: string };
export type BedForecast = {
  /** The clock it was read on (the hospital's demo clock on the server) and the midnight that splits today from tomorrow. */
  now: Date; midnight: Date;
  today: { count: number; byTime?: string }; tomorrow: { count: number };
  timeline: ForecastEntry[]; unlock?: Unlock;
  /** One spoken summary, e.g. "2 beds free by 2 pm: Bed 8 at 1 pm, Bed 14 at 2 pm; 3 tomorrow". */
  label: string;
};

/** Hours an open blocker adds to a bed's out time; a blocker nobody owns adds UNOWNED_HOURS more. */
export const DELAY_HOURS: Record<BlockerKind, number> = { gl: 3, pharmacy: 1.5, result: 2, transport: 1, booking: 0.5 };
export const UNOWNED_HOURS = 1;
const HOUR = 3_600_000, DAY = 24 * HOUR, TZ = 8 * HOUR;
/** A watch bed goes home after tomorrow's round, about 11:00. */
const WATCH_OUT_HOUR = 11;

const dayStart = (d: Date) => new Date(Math.floor((d.getTime() + TZ) / DAY) * DAY - TZ);
/** "11:00" (or "ready 12:30") as today on the ward's clock; undefined when the text has no time. */
const timeToday = (text: string, now: Date) => {
  const m = /(\d{1,2}):(\d{2})/.exec(text);
  return m ? new Date(dayStart(now).getTime() + (Number(m[1]) * 60 + Number(m[2])) * 60_000) : undefined;
};
const later = (a: Date, b: Date) => (a > b ? a : b);
const hours = (h: number) => `${h} h`;

/** "1 pm", "12:30 pm" on the ward's clock. */
export function clockLabel(d: Date) {
  const local = new Date(d.getTime() + TZ), h = local.getUTCHours(), m = local.getUTCMinutes();
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

function forecastBed(b: Bed, now: Date, owners: Record<string, Owner | undefined>): ForecastEntry | undefined {
  const at = (t: Date, confidence: Confidence, reasons: string[]) => ({ bed: b.bed, name: b.name, at: t, confidence, reasons });
  if (b.status === "empty" || b.status === "free") {
    const ready = timeToday(b.predicted, now);
    return ready && ready > now ? at(ready, "high", [b.predicted]) : at(now, "high", ["Free now"]);
  }
  if (b.status === "stable" || !b.name) return undefined;
  if (b.status === "watch") {
    if (/in \d+ days/i.test(b.predicted)) return undefined;
    return at(new Date(dayStart(now).getTime() + DAY + WATCH_OUT_HOUR * HOUR), "low", ["On watch · review on tomorrow's round"]);
  }
  const planned = timeToday(b.predicted, now);
  const base = planned ? later(planned, now) : new Date(now.getTime() + HOUR);
  const reasons = [planned ? `Planned out ${clockLabel(planned)}` : "No planned time · about 1 h"];
  let delay = 0;
  for (const x of b.blockers) {
    delay += DELAY_HOURS[x.kind];
    reasons.push(`${x.label} +${hours(DELAY_HOURS[x.kind])}`);
    if (!owners[x.id]) { delay += UNOWNED_HOURS; reasons.push(`No owner for ${x.label.toLowerCase()} +${hours(UNOWNED_HOURS)}`); }
  }
  return at(new Date(base.getTime() + delay * HOUR), b.blockers.length ? "medium" : "high", reasons);
}

/** When each bed frees up: today's count and the time they are all free by, tomorrow's count, and the one blocker to chase. */
export function forecastBeds(beds: Bed[], now: Date, owners: Record<string, Owner | undefined> = {}): BedForecast {
  const timeline = beds.flatMap(b => forecastBed(b, now, owners) ?? []).sort((a, b) => a.at.getTime() - b.at.getTime());
  const midnight = dayStart(now).getTime() + DAY;
  const today = timeline.filter(e => e.at.getTime() < midnight);
  const tomorrow = timeline.filter(e => e.at.getTime() >= midnight && e.at.getTime() < midnight + DAY);
  const last = today.at(-1)?.at;
  // "by 2 pm": the last bed's time rounded up to the hour; everything free already reads "now".
  const byTime = !last ? undefined : last <= now ? "now" : (() => {
    const hour = Math.ceil(last.getTime() / HOUR) * HOUR;
    return hour >= midnight ? "by midnight" : `by ${clockLabel(new Date(hour))}`;
  })();

  let unlock: Unlock | undefined, soonest = Infinity;
  for (const b of beds) {
    const entry = timeline.find(e => e.bed === b.bed);
    if (!entry || b.status !== "fit") continue;
    for (const x of b.blockers) {
      const owned = Boolean(owners[x.id]), h = DELAY_HOURS[x.kind] + (owned ? 0 : UNOWNED_HOURS), freed = entry.at.getTime() - h * HOUR;
      if (unlock && (h < unlock.hours || (h === unlock.hours && freed >= soonest))) continue;
      soonest = freed;
      unlock = { bed: b.bed, blockerId: x.id, label: x.label, owner: owners[x.id] ?? SUGGESTED[x.kind], owned, hours: h, line: `Chase ${b.bed}'s ${x.label.toLowerCase()} → frees ~${hours(h)} earlier` };
    }
  }

  const nBeds = (n: number) => `${n} bed${n === 1 ? "" : "s"}`;
  const list = today.map(e => `${e.bed} ${e.at <= now ? "now" : `at ${clockLabel(e.at)}`}`).join(", ");
  const label = today.length ? `${nBeds(today.length)} free ${byTime}: ${list}; ${tomorrow.length} tomorrow` : `No beds free today; ${tomorrow.length} tomorrow`;
  return { now, midnight: new Date(midnight), today: { count: today.length, byTime }, tomorrow: { count: tomorrow.length }, timeline, unlock, label };
}

/** My Day's one line: "Forecast · 2 beds free by 2 pm · 3 tomorrow". */
export const forecastLine = (f: BedForecast) =>
  `Forecast · ${f.today.count ? `${f.today.count} bed${f.today.count === 1 ? "" : "s"} free ${f.today.byTime}` : "none free today"} · ${f.tomorrow.count} tomorrow`;
