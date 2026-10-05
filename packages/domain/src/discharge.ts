import { defaultCheckInDays } from "./check-ins";
import { followUpLine } from "./findings";
import type { Encounter, Patient, PrescriptionCheck, Task } from "./types";

/**
 * Discharge in one card: a drafted summary, the few things that still block the patient from
 * leaving (final guarantee letter, take-home medicines, follow-up), a patient leaflet, and a
 * receipt that says how much earlier the bed is free.
 *
 * Nothing here is written for one person: the plan is read from the patient's own record (their ward
 * record, their take-home list as charted) and the checks from their visit's rows (VisitFacts). A fact
 * nobody recorded has no check and no line; it is never assumed.
 * ponytail: condition rules name the diagnosis and pick the leaflet from the record's words until a model
 * drafts them (discharge.draft); the blockers stay derived from state so nothing pending can be drafted away.
 */
export type Language = "ms" | "en" | "zh";
export type FollowUp = "1w" | "2w" | "4w";
/** `checkInDays`: the check-in days the doctor chose (sorted); unset until changed, when the condition's suggestion applies (defaultCheckInDays). */
export type DischargeState = { glReceived: boolean; medsConfirmed: boolean; followUp?: FollowUp; language: Language; checkInDays?: number[]; dischargedAt?: string; savedMinutes?: number };
export type MedChange = { name: string; change: "changed" | "new" | "stopped" | "unchanged"; detail: string };
/** One recorded observation: its latest reading and when it was taken (ISO). */
export type Vital = { kind: string; value: number; unit: string; at: string };
/**
 * What the visit's own rows say, times as ISO strings. The server reads them (discharge.plan: the admission, its
 * guarantee letter, the observations chart, the stored draft); sample mode carries the fixture's own.
 */
export type VisitFacts = {
  /** When the bed was marked fit to go. */
  fitAt?: string;
  /** The guarantee letter this stay waits on; none when the patient pays themselves. */
  gl?: { insurer: string; requestedAt: string };
  /** The latest reading of each observation on the chart. */
  vitals?: Vital[];
  /** A model's discharge summary is stored for this visit. */
  drafted?: boolean;
};
export type DischargePlan = {
  bed: string; summary: { diagnosis: string; course: string; plan: string }; full: string;
  meds: MedChange[]; leaflet: Record<Language, string>;
  /** The condition rule the plan came from ("pneumonia"), so Sona Care words the review and warning signs for it; none when no rule matched. */
  condition?: string;
  /** The visit's recorded facts, which the checks read. */
  visit: VisitFacts;
};

export const LANGUAGES: { id: Language; label: string; name: string }[] = [
  { id: "ms", label: "BM", name: "Bahasa Melayu" }, { id: "en", label: "EN", name: "English" }, { id: "zh", label: "中文", name: "Chinese" },
];
export const FOLLOW_UPS: { id: FollowUp; label: string; days: number }[] = [
  { id: "1w", label: "1 wk", days: 7 }, { id: "2w", label: "2 wk", days: 14 }, { id: "4w", label: "4 wk", days: 28 },
];
export const EMPTY_DISCHARGE: DischargeState = { glReceived: false, medsConfirmed: false, language: "ms" };

/**
 * What a plan is built from: the patient's record as the app and the server hold it (DEMO_PATIENTS,
 * or `patients.record` spread over the row), with the ward's view when they are admitted, the bed
 * from their admission and their visit's facts. Every field is optional, so a thin record still gets a plan.
 * `takeHome`: the take-home list as the ward reconciled it and charted it, kept in the record.
 */
export type PlanRecord = Partial<Pick<Patient, "id" | "name" | "complaint" | "history" | "medicines" | "allergies">> & {
  bed?: string; ward?: { waitingHours?: number; sbar?: { s: string; b: string; a: string; r: string } };
  takeHome?: MedChange[]; visit?: VisitFacts;
};
/** `title`: the condition in its leaflet's own words, the name the leaflet goes by in the hospital's library (PATIENT_LEAFLETS). */
type Condition = { id: string; match: RegExp; diagnosis: string; title: Record<Language, string>; leaflet: Record<Language, string> };

// ponytail: condition rules over the record's own words stand in for draft_discharge (delivery plan, Discharge)
// when no model answers: they name the diagnosis and pick a general leaflet. They never write a medicine or a dose.
const CONDITIONS: Condition[] = [
  { id: "pyelonephritis", match: /pyelonephritis|kidney infection/i, diagnosis: "Acute pyelonephritis", title: { ms: "Jangkitan buah pinggang", en: "Kidney infection", zh: "肾脏感染" },
    leaflet: {
      ms: "Anda dirawat kerana jangkitan buah pinggang. Habiskan semua tablet antibiotik walaupun sudah berasa sihat, dan minum banyak air. Datang semula segera jika demam kembali, sakit belakang atau muntah berterusan.",
      en: "You were treated for a kidney infection. Finish every antibiotic tablet, even when you feel better, and drink plenty of water. Come back straight away if the fever returns, you have back pain or you keep vomiting.",
      zh: "您因肾脏感染接受了治疗。即使感觉好转，也请吃完所有抗生素，并多喝水。如再次发烧、腰背疼痛或持续呕吐，请立即回院。",
    } },
  { id: "appendicitis", match: /appendic/i, diagnosis: "Acute appendicitis, laparoscopic appendicectomy", title: { ms: "Pembedahan membuang apendiks", en: "Keyhole surgery to remove your appendix", zh: "阑尾切除手术" },
    leaflet: {
      ms: "Anda telah menjalani pembedahan lubang kunci untuk membuang apendiks. Ambil paracetamol dan ibuprofen untuk sakit, pastikan luka kering selama 2 hari dan elakkan mengangkat barang berat selama 2 minggu. Datang semula segera jika demam, sakit perut bertambah teruk atau luka merah dan berair.",
      en: "You had keyhole surgery to remove your appendix. Take paracetamol and ibuprofen for pain, keep the wounds dry for 2 days and avoid heavy lifting for 2 weeks. Come back straight away if you have a fever, worsening tummy pain or a red, leaking wound.",
      zh: "您接受了腹腔镜阑尾切除手术。疼痛时服用扑热息痛和布洛芬，伤口保持干燥两天，两周内避免提重物。如发烧、腹痛加剧或伤口红肿渗液，请立即回院。",
    } },
  { id: "cellulitis", match: /cellulitis/i, diagnosis: "Cellulitis of the leg", title: { ms: "Jangkitan kulit pada kaki", en: "Skin infection of the leg", zh: "腿部皮肤感染" },
    leaflet: {
      ms: "Anda dirawat kerana jangkitan kulit pada kaki. Makan antibiotik empat kali sehari selama 5 hari lagi dan tinggikan kaki semasa berehat. Datang semula segera jika kemerahan merebak, demam atau kaki menjadi sangat sakit.",
      en: "You were treated for a skin infection of your leg. Take the antibiotic four times a day for 5 more days and keep your leg raised when resting. Come back straight away if the redness spreads, you get a fever or the leg becomes very painful.",
      zh: "您因腿部皮肤感染接受了治疗。请每天服用四次抗生素，再服五天，休息时把腿抬高。如红肿扩散、发烧或腿部剧痛，请立即回院。",
    } },
  { id: "pneumonia", match: /pneumonia|chest infection/i, diagnosis: "Community-acquired pneumonia", title: { ms: "Jangkitan paru-paru", en: "Chest infection", zh: "肺部感染" },
    leaflet: {
      ms: "Anda dirawat kerana jangkitan paru-paru. Habiskan kursus antibiotik seperti yang diarahkan. Datang semula segera jika sukar bernafas, bibir menjadi biru, atau demam kembali.",
      en: "You were treated for a chest infection. Finish your antibiotic course as prescribed. Come back straight away if breathing gets harder, your lips turn blue, or the fever returns.",
      zh: "您因肺部感染接受了治疗。请按医嘱服完抗生素。如呼吸更困难、嘴唇发紫或再次发烧，请立即回院。",
    } },
  { id: "heart-failure", match: /heart failure/i, diagnosis: "Acute decompensated heart failure", title: { ms: "Kegagalan jantung", en: "Heart failure", zh: "心力衰竭" },
    leaflet: {
      ms: "Anda dirawat kerana kegagalan jantung (air di paru-paru). Makan pil air setiap pagi, timbang berat badan setiap hari dan ikut had minuman anda. Datang semula segera jika berat naik 2 kg dalam 3 hari, buku lali bengkak atau sesak nafas ketika berbaring.",
      en: "You were treated for heart failure (fluid on the lungs). Take your water tablet every morning, weigh yourself daily and keep to your fluid limit. Come back straight away if your weight goes up by 2 kg in 3 days, your ankles swell or you are breathless lying flat.",
      zh: "您因心力衰竭（肺部积液）接受了治疗。请每天早上服用利尿药，每天称体重，并遵守饮水限制。如三天内体重增加两公斤、脚踝肿胀或平躺时气喘，请立即回院。",
    } },
  { id: "stroke", match: /stroke/i, diagnosis: "Ischaemic stroke, medically stable", title: { ms: "Strok", en: "Stroke", zh: "中风" },
    leaflet: {
      ms: "Anda dirawat kerana strok. Makan ubat pencair darah dan ubat kolesterol setiap hari dan hadiri temujanji pemulihan. Hubungi 999 segera jika muka senget, lengan atau kaki menjadi lemah, atau percakapan berubah.",
      en: "You were treated for a stroke. Take your blood thinner and cholesterol tablet every day and keep your rehabilitation appointments. Call 999 straight away if your face droops, an arm or leg goes weak, or your speech changes.",
      zh: "您因中风接受了治疗。请每天服用抗凝血药和降胆固醇药，并按时参加康复治疗。如脸部下垂、手脚无力或说话异常，请立即拨打999。",
    } },
];
const GENERIC_LEAFLET: Record<Language, string> = {
  ms: "Pasukan penjagaan anda akan menerangkan diagnosis dan ubat-ubatan sebelum anda pulang. Makan ubat seperti yang disenaraikan dalam helaian ubat bawa pulang. Datang semula segera jika berasa lebih teruk, demam atau sukar bernafas.",
  en: "Your care team will go through your diagnosis and medicines with you before you leave. Take your medicines as listed on your take-home sheet. Come back straight away if you feel worse, have a fever or find it hard to breathe.",
  zh: "出院前，医护团队会向您说明诊断和药物。请按出院用药单服药。如感觉更差、发烧或呼吸困难，请立即回院。",
};

/**
 * The hospital's general patient leaflets as its library holds them (the seed ingests each as a document of kind
 * "leaflet", one per language), so Sona Care's general advice can rest on them and name them. `text` is the leaflet
 * above, word for word: nothing clinical is written here. `about` is the rule's diagnosis, which the search reads too
 * (a patient asks about "pneumonia"; her leaflet says "chest infection").
 */
export const PATIENT_LEAFLETS: { id: string; about: string; title: Record<Language, string>; text: Record<Language, string> }[] = [
  ...CONDITIONS.map(c => ({ id: c.id, about: c.diagnosis, title: c.title, text: c.leaflet })),
  { id: "going-home", about: "Discharge from hospital", title: { ms: "Pulang dari hospital", en: "Going home from hospital", zh: "出院回家" }, text: GENERIC_LEAFLET },
];

const sentence = (text: string) => { const t = text.trim(); return !t || /[.!?]$/.test(t) ? t : `${t}.`; };
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * The patient's discharge plan, from their own record: the condition it names, the ward's course and recommendation,
 * and the take-home list the ward charted (until one is charted, their own medicines carry on).
 */
export function planFor(record: PlanRecord): DischargePlan {
  const sbar = record.ward?.sbar;
  const words = [sbar?.s, sbar?.r, record.complaint, ...(record.history ?? [])].filter(Boolean).join(" ");
  const condition = CONDITIONS.find(c => c.match.test(words));
  const background = sbar?.b && !/no significant/i.test(sbar.b) ? sbar.b.replace(/\.$/, "") : undefined;
  const named = condition?.diagnosis ?? record.complaint?.replace(/\.$/, "") ?? "Diagnosis to confirm from the notes";
  const diagnosis = sentence(background ? `${named}, on a background of ${lowerFirst(background)}` : named);
  const course = [sbar?.s, sbar?.a].filter((s): s is string => Boolean(s)).map(sentence).join(" ") || "Course to be written from the notes.";
  const plan = sbar?.r ? sentence(sbar.r) : "Plan to confirm at the discharge review.";
  // An unknown ingredient is left for reconciliation, not carried home.
  const own = (record.medicines ?? []).map(m => m.split(",")[0]!.trim()).filter(name => name && !/unknown/i.test(name));
  return {
    bed: record.bed ?? "Ward bed", summary: { diagnosis, course, plan }, full: `${diagnosis} ${course} ${plan} Synthetic record, not a real patient.`,
    meds: record.takeHome ?? own.map(name => ({ name, change: "unchanged" as const, detail: "Continue as before" })),
    leaflet: condition?.leaflet ?? GENERIC_LEAFLET, condition: condition?.id, visit: record.visit ?? {},
  };
}

export const canDischarge = (patient: Patient) => !patient.incomplete;

/** An incidental finding nobody has tracked or dismissed yet (demo flow 6); it travels with the patient. */
export type OpenFinding = { id: string; label: string; action: string | null; dueAt?: Date | string | null };

/** Something the ward is still waiting on (a pending result, a ride home), a blocker exactly as the ward shows it. */
export type Wait = { id: string; label: string; detail: string };

// ponytail: the ward's clock is Malaysia's, as ward.ts keeps it, so the server and a phone word a time the same way; the hospital's own zone once a second site joins.
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" });
// Stable enough to go home: the usual clinical-stability limits (Halm's criteria). A limit is read only for a vital that was taken.
const STABLE: Record<string, [label: string, ok: (value: number) => boolean]> = {
  temperature: ["Temp", v => v <= 37.8], pulse: ["Pulse", v => v <= 100], "respiratory-rate": ["Resp", v => v <= 24], systolic: ["Systolic", v => v >= 90], "oxygen-saturation": ["SpO₂", v => v >= 90],
};
/**
 * "Observations stable" from the chart's latest readings: blocked by any out of range, absent when none was taken.
 * ponytail: the latest reading of each vital counts however old it is (the detail says when the last was taken); a
 * maximum age per vital once the ward's observation schedule is recorded.
 */
function observationsCheck(vitals: Vital[] = []): PrescriptionCheck[] {
  const read = vitals.flatMap(v => { const rule = STABLE[v.kind]; return rule ? [{ line: `${rule[0]} ${v.value} ${v.unit}`, ok: rule[1](v.value), at: v.at }] : []; });
  if (!read.length) return [];
  const off = read.filter(r => !r.ok), last = read.map(r => r.at).sort().at(-1)!;
  return [{ id: "observations", label: "Observations stable", status: off.length ? "blocked" : "passed", detail: off.length ? off.map(r => r.line).join(" · ") : `${read.length} in range · last taken ${clock(last)}` }];
}

/**
 * What still stands between the patient and the door, in the prescribe card's check shape. A check exists only when
 * the record can answer it: observations when some were charted, the summary once a model drafted one, the guarantee
 * letter when the stay has one.
 */
export function dischargeChecks(state: DischargeState, plan: DischargePlan, findings: OpenFinding[] = [], waits: Wait[] = []): PrescriptionCheck[] {
  const changes = plan.meds.filter(m => m.change !== "unchanged"), { gl, vitals, drafted } = plan.visit;
  const count = (c: MedChange["change"]) => changes.filter(m => m.change === c).length;
  const chosen = FOLLOW_UPS.find(f => f.id === state.followUp);
  return [
    ...observationsCheck(vitals),
    ...(drafted ? [{ id: "summary", label: "Discharge summary drafted", status: "passed" as const, detail: "From the visit record" }] : []),
    ...(gl ? [{ id: "gl", label: "Final guarantee letter", status: state.glReceived ? "passed" as const : "blocked" as const, detail: `${gl.insurer} · requested ${clock(gl.requestedAt)}` }] : []),
    { id: "meds", label: "Take-home medicines", status: state.medsConfirmed ? "passed" : "blocked", detail: [count("changed") && `${count("changed")} changed`, count("new") && `${count("new")} new`, count("stopped") && `${count("stopped")} stopped`].filter(Boolean).join(" · ") || (plan.meds.length ? `${plan.meds.length} to continue` : "None recorded") },
    { id: "followup", label: "Follow-up booked", status: chosen ? "passed" : "blocked", detail: chosen ? `Clinic review · ${chosen.label}` : "Not chosen yet" },
    ...findings.map(f => ({ id: `finding-${f.id}`, label: f.label, status: "blocked" as const, detail: followUpLine(f) })),
    ...waits.map(w => ({ ...w, status: "blocked" as const })),
  ];
}

// ponytail: a fixed ward benchmark for the wait from "fit for discharge" to leaving; real bed data replaces it.
export const TYPICAL_WAIT_MINUTES = 275;
/** Minutes the bed frees ahead of the ward's typical fit-to-door wait (0 when slower, or when nobody marked the bed fit). */
export function minutesSaved(fitAt: Date | undefined, at: Date): number {
  return fitAt ? Math.max(0, TYPICAL_WAIT_MINUTES - Math.round((at.getTime() - fitAt.getTime()) / 60000)) : 0;
}
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? `${h} h ${m} m` : `${m} m`;
}

/** The follow-up tasks a discharge leaves behind, so they travel into Tasks and handover. */
export function dischargeTasks(patient: Patient, state: DischargeState, plan: DischargePlan, at: Date): Task[] {
  const days = FOLLOW_UPS.find(f => f.id === state.followUp)?.days ?? 14;
  const due = new Date(at.getTime() + days * 86400000).toLocaleDateString([], { day: "numeric", month: "short" });
  const insurer = plan.visit.gl?.insurer;
  return [
    { id: `discharge-review-${patient.id}`, title: `Book clinic review for ${patient.name.split(" ")[0]}`, owner: "Clinic clerk", due, completed: false, provenance: "clinician" },
    // A final claim only where an insurer is paying: a stay with no guarantee letter is self-pay.
    ...(insurer ? [{ id: `discharge-claim-${patient.id}`, title: `Submit final claim to ${insurer.toLowerCase()}`, owner: "Billing", due: "Today", completed: false, provenance: "clinician" as const }] : []),
  ];
}

/** An approved consequential action; structurally the `ApprovedCommand` contract in @sona-ai/api. */
export type Approval = { encounterId: string; requestId: string; approvedBy: string };
export type Refusal = { status: "refused"; reason: "unapproved" | "blocked"; open: string[] };
export type DischargeReceipt = { status: "discharged"; encounterId: string; requestId: string; approvedBy: string; dischargedAt: string; savedMinutes: number };

/** Labels of the checks still blocked; empty when nothing stands in the way. */
export const openLabels = (checks: PrescriptionCheck[]) => checks.filter(c => c.status === "blocked").map(c => c.label);

/** Server rule: no discharge without a named approver or while any blocker is open, whatever the app shows. */
export function decideDischarge(state: DischargeState, plan: DischargePlan, command: Approval, fitAt: Date | undefined, at: Date, findings: OpenFinding[] = [], waits: Wait[] = []): Refusal | DischargeReceipt {
  if (!command.approvedBy.trim()) return { status: "refused", reason: "unapproved", open: [] };
  const open = openLabels(dischargeChecks(state, plan, findings, waits));
  if (open.length) return { status: "refused", reason: "blocked", open };
  const { encounterId, requestId, approvedBy } = command;
  return { status: "discharged", encounterId, requestId, approvedBy, dischargedAt: at.toISOString(), savedMinutes: minutesSaved(fitAt, at) };
}

/** The check-in days this discharge uses: the doctor's pick, else the plan's condition suggests them. */
export const checkInDaysOf = (state: DischargeState, plan: DischargePlan) => state.checkInDays?.length ? state.checkInDays : defaultCheckInDays(plan.condition);

export function discharge(encounter: Encounter, patient: Patient, fitAt: Date | undefined, at: Date): Encounter {
  const state = encounter.discharge ?? EMPTY_DISCHARGE, plan = planFor(patient);
  const tasks = dischargeTasks(patient, state, plan, at).filter(t => !encounter.tasks.some(e => e.id === t.id));
  return { ...encounter, discharge: { ...state, checkInDays: checkInDaysOf(state, plan), dischargedAt: at.toISOString(), savedMinutes: minutesSaved(fitAt, at) }, tasks: [...encounter.tasks, ...tasks] };
}
