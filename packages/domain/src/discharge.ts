import { followUpLine } from "./findings";
import type { Encounter, Patient, PrescriptionCheck, Task } from "./types";

/**
 * Discharge in one card: a drafted summary, the few things that still block the patient from
 * leaving (final guarantee letter, take-home medicines, follow-up), a patient leaflet, and a
 * receipt that says how much earlier the bed is free.
 *
 * ponytail: Amelia's plan is authored; every other patient's is built from their own record by the
 * condition rules below. A model drafts the summary and leaflet later (discharge.draft); the
 * blockers stay derived from state so nothing pending can be drafted away.
 */
export type Language = "ms" | "en" | "zh";
export type FollowUp = "1w" | "2w" | "4w";
export type DischargeState = { glReceived: boolean; medsConfirmed: boolean; followUp?: FollowUp; language: Language; dischargedAt?: string; savedMinutes?: number };
export type MedChange = { name: string; change: "changed" | "new" | "stopped" | "unchanged"; detail: string };
export type DischargePlan = {
  bed: string; fitMinutesAgo: number; insurer: string; glRequestedAt: string;
  summary: { diagnosis: string; course: string; plan: string }; full: string;
  meds: MedChange[]; leaflet: Record<Language, string>;
  /** The follow-up the discharge check asks for, and why. */
  followUp: string;
};

export const LANGUAGES: { id: Language; label: string; name: string }[] = [
  { id: "ms", label: "BM", name: "Bahasa Melayu" }, { id: "en", label: "EN", name: "English" }, { id: "zh", label: "中文", name: "Chinese" },
];
export const FOLLOW_UPS: { id: FollowUp; label: string; days: number }[] = [
  { id: "1w", label: "1 wk", days: 7 }, { id: "2w", label: "2 wk", days: 14 }, { id: "4w", label: "4 wk", days: 28 },
];
export const EMPTY_DISCHARGE: DischargeState = { glReceived: false, medsConfirmed: false, language: "ms" };

/** The respiratory demo patient's authored plan (Amelia Tan, SYN-1042). */
const PLAN: DischargePlan = {
  bed: "Bed 6", fitMinutesAgo: 25, insurer: "Synthetic insurer", glRequestedAt: "09:40",
  summary: {
    diagnosis: "Community-acquired pneumonia, mild (CURB-65 0), on background asthma.",
    course: "36 h observation. Afebrile 18 h, SpO₂ 97% on room air, eating and walking.",
    plan: "Oral azithromycin 2 more days, inhaler as needed, clinic review.",
  },
  full: "Admitted with five days of cough and one day of fever. Chest film showed right lower zone consolidation. Treated with IV then oral azithromycin (penicillin allergy reported) and 4-hourly nebulised salbutamol, weaned to her own inhaler. Observations normal for 18 hours; no oxygen requirement. Safety-netting explained in her preferred language. Synthetic record, not a real patient.",
  meds: [
    { name: "Azithromycin", change: "changed", detail: "IV 500 mg to oral 500 mg daily, 2 more days" },
    { name: "Paracetamol", change: "new", detail: "1 g every 6 h as needed, max 4 g a day" },
    { name: "Nebulised salbutamol", change: "stopped", detail: "Back to her own inhaler as needed" },
    { name: "Cetirizine", change: "unchanged", detail: "Patient-reported, continue" },
  ],
  leaflet: {
    ms: "Anda dirawat kerana jangkitan paru-paru. Makan azithromycin sekali sehari selama 2 hari lagi. Datang semula segera jika sukar bernafas, bibir menjadi biru, atau demam kembali.",
    en: "You were treated for a chest infection. Take azithromycin once a day for 2 more days. Come back straight away if breathing gets harder, your lips turn blue, or the fever returns.",
    zh: "您因肺部感染接受了治疗。请每天服用一次阿奇霉素，再服两天。如呼吸更困难、嘴唇发紫或再次发烧，请立即回院。",
  },
  followUp: "Clinic review · 2 weeks is usual after pneumonia",
};

/**
 * What a plan is built from: the patient's record as the app and the server hold it (DEMO_PATIENTS,
 * or `patients.record` spread over the row), with the ward's view when they are admitted and the bed
 * from their admission. Every field is optional, so a thin record still gets a plan.
 */
export type PlanRecord = Partial<Pick<Patient, "id" | "name" | "complaint" | "history" | "medicines" | "allergies">> & {
  bed?: string; ward?: { waitingHours?: number; sbar?: { s: string; b: string; a: string; r: string } };
};
type Condition = { match: RegExp; diagnosis: string; plan: string; followUp: string; meds: (record: PlanRecord) => MedChange[]; leaflet: Record<Language, string> };
const PARACETAMOL: MedChange = { name: "Paracetamol", change: "new", detail: "1 g every 6 h as needed, max 4 g a day" };
const penicillinAllergy = (r: PlanRecord) => /penicillin/i.test(r.allergies ?? "");

// ponytail: condition rules over the record's own words stand in for draft_discharge + reconcile_medicines
// (delivery plan, Discharge) until Gemma is hosted. Synthetic regimens for a demo, not advice.
const CONDITIONS: Condition[] = [
  { match: /pyelonephritis|kidney infection/i, diagnosis: "Acute pyelonephritis", plan: "Oral antibiotic to finish 10 days, guided by the urine culture; clinic review with the result.",
    followUp: "Clinic review · 1–2 weeks, with the urine culture result",
    meds: () => [{ name: "Cefuroxime", change: "changed", detail: "IV to oral 500 mg twice daily, to finish 10 days (check against sensitivities)" }, PARACETAMOL],
    leaflet: {
      ms: "Anda dirawat kerana jangkitan buah pinggang. Habiskan semua tablet antibiotik walaupun sudah berasa sihat, dan minum banyak air. Datang semula segera jika demam kembali, sakit belakang atau muntah berterusan.",
      en: "You were treated for a kidney infection. Finish every antibiotic tablet, even when you feel better, and drink plenty of water. Come back straight away if the fever returns, you have back pain or you keep vomiting.",
      zh: "您因肾脏感染接受了治疗。即使感觉好转，也请吃完所有抗生素，并多喝水。如再次发烧、腰背疼痛或持续呕吐，请立即回院。",
    } },
  { match: /appendic/i, diagnosis: "Acute appendicitis, laparoscopic appendicectomy", plan: "Simple pain relief at home, wound care, no heavy lifting for 2 weeks; surgical clinic review.",
    followUp: "Surgical clinic · wound check in 1–2 weeks",
    meds: () => [PARACETAMOL, { name: "Ibuprofen", change: "new", detail: "400 mg every 8 h with food, for 3 days" }, { name: "Morphine", change: "stopped", detail: "Ward-only pain relief, not needed at home" }],
    leaflet: {
      ms: "Anda telah menjalani pembedahan lubang kunci untuk membuang apendiks. Ambil paracetamol dan ibuprofen untuk sakit, pastikan luka kering selama 2 hari dan elakkan mengangkat barang berat selama 2 minggu. Datang semula segera jika demam, sakit perut bertambah teruk atau luka merah dan berair.",
      en: "You had keyhole surgery to remove your appendix. Take paracetamol and ibuprofen for pain, keep the wounds dry for 2 days and avoid heavy lifting for 2 weeks. Come back straight away if you have a fever, worsening tummy pain or a red, leaking wound.",
      zh: "您接受了腹腔镜阑尾切除手术。疼痛时服用扑热息痛和布洛芬，伤口保持干燥两天，两周内避免提重物。如发烧、腹痛加剧或伤口红肿渗液，请立即回院。",
    } },
  { match: /cellulitis/i, diagnosis: "Cellulitis of the leg", plan: "Oral antibiotic 5 more days, leg raised at rest; wound clinic in a week.",
    followUp: "Wound clinic · in 1 week",
    meds: r => [penicillinAllergy(r) ? { name: "Clindamycin", change: "changed", detail: "IV to oral 300 mg four times daily, 5 more days" } : { name: "Flucloxacillin", change: "changed", detail: "IV to oral 500 mg four times daily, 5 more days" }, PARACETAMOL],
    leaflet: {
      ms: "Anda dirawat kerana jangkitan kulit pada kaki. Makan antibiotik empat kali sehari selama 5 hari lagi dan tinggikan kaki semasa berehat. Datang semula segera jika kemerahan merebak, demam atau kaki menjadi sangat sakit.",
      en: "You were treated for a skin infection of your leg. Take the antibiotic four times a day for 5 more days and keep your leg raised when resting. Come back straight away if the redness spreads, you get a fever or the leg becomes very painful.",
      zh: "您因腿部皮肤感染接受了治疗。请每天服用四次抗生素，再服五天，休息时把腿抬高。如红肿扩散、发烧或腿部剧痛，请立即回院。",
    } },
  { match: /pneumonia|chest infection/i, diagnosis: "Community-acquired pneumonia", plan: "Oral antibiotic to complete 5 days; clinic review.",
    followUp: "Clinic review · 2 weeks is usual after pneumonia",
    meds: r => [penicillinAllergy(r) ? { name: "Azithromycin", change: "changed", detail: "IV to oral 500 mg daily, to complete 5 days" } : { name: "Amoxicillin", change: "changed", detail: "IV to oral 1 g three times daily, to complete 5 days" }, PARACETAMOL],
    leaflet: {
      ms: "Anda dirawat kerana jangkitan paru-paru. Habiskan kursus antibiotik seperti yang diarahkan. Datang semula segera jika sukar bernafas, bibir menjadi biru, atau demam kembali.",
      en: "You were treated for a chest infection. Finish your antibiotic course as prescribed. Come back straight away if breathing gets harder, your lips turn blue, or the fever returns.",
      zh: "您因肺部感染接受了治疗。请按医嘱服完抗生素。如呼吸更困难、嘴唇发紫或再次发烧，请立即回院。",
    } },
  { match: /heart failure/i, diagnosis: "Acute decompensated heart failure", plan: "Oral diuretic, daily weights and a fluid limit; heart failure clinic with renal function.",
    followUp: "Heart failure clinic · 1–2 weeks, with renal function",
    meds: () => [{ name: "Furosemide", change: "changed", detail: "IV to oral 40 mg each morning; weigh daily" }],
    leaflet: {
      ms: "Anda dirawat kerana kegagalan jantung (air di paru-paru). Makan pil air setiap pagi, timbang berat badan setiap hari dan ikut had minuman anda. Datang semula segera jika berat naik 2 kg dalam 3 hari, buku lali bengkak atau sesak nafas ketika berbaring.",
      en: "You were treated for heart failure (fluid on the lungs). Take your water tablet every morning, weigh yourself daily and keep to your fluid limit. Come back straight away if your weight goes up by 2 kg in 3 days, your ankles swell or you are breathless lying flat.",
      zh: "您因心力衰竭（肺部积液）接受了治疗。请每天早上服用利尿药，每天称体重，并遵守饮水限制。如三天内体重增加两公斤、脚踝肿胀或平躺时气喘，请立即回院。",
    } },
  { match: /stroke/i, diagnosis: "Ischaemic stroke, medically stable", plan: "Secondary prevention; transfer for inpatient rehabilitation; stroke clinic.",
    followUp: "Stroke clinic · 4 weeks, after rehabilitation starts",
    meds: () => [{ name: "Apixaban", change: "new", detail: "5 mg twice daily, for atrial fibrillation (start as the stroke team planned)" }, { name: "Atorvastatin", change: "new", detail: "40 mg at night" }],
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

const sentence = (text: string) => { const t = text.trim(); return !t || /[.!?]$/.test(t) ? t : `${t}.`; };
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** A plan from the patient's own record: the condition it names, their own medicines carried on, the ward's course. */
function derivedPlan(record: PlanRecord): DischargePlan {
  const sbar = record.ward?.sbar;
  const words = [sbar?.s, sbar?.r, record.complaint, ...(record.history ?? [])].filter(Boolean).join(" ");
  const condition = CONDITIONS.find(c => c.match.test(words));
  const background = sbar?.b && !/no significant/i.test(sbar.b) ? sbar.b.replace(/\.$/, "") : undefined;
  const named = condition?.diagnosis ?? record.complaint?.replace(/\.$/, "") ?? "Diagnosis to confirm from the notes";
  const diagnosis = sentence(background ? `${named}, on a background of ${lowerFirst(background)}` : named);
  const course = [sbar?.s, sbar?.a].filter((s): s is string => Boolean(s)).map(sentence).join(" ") || "Course to be written from the notes.";
  const plan = condition?.plan ?? (sbar?.r ? sentence(sbar.r) : "Plan to confirm at the discharge review.");
  const drafted = condition?.meds(record) ?? [];
  // Their own medicines carry on unless the drafted list already changes them; an unknown ingredient is left for reconciliation.
  const own = (record.medicines ?? []).map(m => m.split(",")[0]!.trim())
    .filter(name => name && !/unknown/i.test(name) && !drafted.some(d => d.name.toLowerCase() === name.toLowerCase()));
  return {
    bed: record.bed ?? "Ward bed", fitMinutesAgo: Math.round((record.ward?.waitingHours ?? 0) * 60), insurer: "Synthetic insurer", glRequestedAt: "today",
    summary: { diagnosis, course, plan }, full: `${diagnosis} ${course} ${plan} Synthetic record, not a real patient.`,
    meds: [...drafted, ...own.map(name => ({ name, change: "unchanged" as const, detail: "Continue as before" }))],
    leaflet: condition?.leaflet ?? GENERIC_LEAFLET, followUp: condition?.followUp ?? "Clinic review · timing to confirm",
  };
}

export const canDischarge = (patient: Patient) => !patient.incomplete;
/** The patient's discharge plan: Amelia's authored one (also for a record with no ID), anyone else's built from their record. */
export const planFor = (record: PlanRecord): DischargePlan =>
  !record.id || record.id === "SYN-1042" ? { ...PLAN, ...(record.bed && { bed: record.bed }) } : derivedPlan(record);

/** An incidental finding nobody has tracked or dismissed yet (demo flow 6); it travels with the patient. */
export type OpenFinding = { id: string; label: string; action: string | null; dueAt?: Date | string | null };

/** What still stands between the patient and the door, in the prescribe card's check shape. */
export function dischargeChecks(state: DischargeState, plan: DischargePlan, findings: OpenFinding[] = []): PrescriptionCheck[] {
  const changes = plan.meds.filter(m => m.change !== "unchanged");
  const count = (c: MedChange["change"]) => changes.filter(m => m.change === c).length;
  return [
    { id: "observations", label: "Observations stable", status: "passed", detail: "Normal for 18 h" },
    { id: "summary", label: "Discharge summary drafted", status: "passed", detail: "From the visit record" },
    { id: "gl", label: "Final guarantee letter", status: state.glReceived ? "passed" : "blocked", detail: `${plan.insurer} · requested ${plan.glRequestedAt}` },
    { id: "meds", label: "Take-home medicines", status: state.medsConfirmed ? "passed" : "blocked", detail: [count("changed") && `${count("changed")} changed`, count("new") && `${count("new")} new`, count("stopped") && `${count("stopped")} stopped`].filter(Boolean).join(" · ") },
    { id: "followup", label: "Follow-up booked", status: state.followUp ? "passed" : "blocked", detail: plan.followUp },
    ...findings.map(f => ({ id: `finding-${f.id}`, label: f.label, status: "blocked" as const, detail: followUpLine(f) })),
  ];
}

// ponytail: a fixed ward benchmark for the wait from "fit for discharge" to leaving; real bed data replaces it.
export const TYPICAL_WAIT_MINUTES = 275;
/** Minutes the bed frees ahead of the ward's typical fit-to-door wait (0 when slower). */
export function minutesSaved(fitAt: Date, at: Date): number {
  return Math.max(0, TYPICAL_WAIT_MINUTES - Math.round((at.getTime() - fitAt.getTime()) / 60000));
}
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? `${h} h ${m} m` : `${m} m`;
}

/** The follow-up tasks a discharge leaves behind, so they travel into Tasks and handover. */
export function dischargeTasks(patient: Patient, state: DischargeState, plan: DischargePlan, at: Date): Task[] {
  const days = FOLLOW_UPS.find(f => f.id === state.followUp)?.days ?? 14;
  const due = new Date(at.getTime() + days * 86400000).toLocaleDateString([], { day: "numeric", month: "short" });
  return [
    { id: `discharge-review-${patient.id}`, title: `Book clinic review for ${patient.name.split(" ")[0]}`, owner: "Clinic clerk", due, completed: false, provenance: "clinician" },
    { id: `discharge-claim-${patient.id}`, title: `Submit final claim to ${plan.insurer.toLowerCase()}`, owner: "Billing", due: "Today", completed: false, provenance: "clinician" },
  ];
}

/** An approved consequential action; structurally the `ApprovedCommand` contract in @sona-ai/api. */
export type Approval = { encounterId: string; requestId: string; approvedBy: string };
export type Refusal = { status: "refused"; reason: "unapproved" | "blocked"; open: string[] };
export type DischargeReceipt = { status: "discharged"; encounterId: string; requestId: string; approvedBy: string; dischargedAt: string; savedMinutes: number };

/** Labels of the checks still blocked; empty when nothing stands in the way. */
export const openLabels = (checks: PrescriptionCheck[]) => checks.filter(c => c.status === "blocked").map(c => c.label);

/** Server rule: no discharge without a named approver or while any blocker is open, whatever the app shows. */
export function decideDischarge(state: DischargeState, plan: DischargePlan, command: Approval, fitAt: Date, at: Date, findings: OpenFinding[] = []): Refusal | DischargeReceipt {
  if (!command.approvedBy.trim()) return { status: "refused", reason: "unapproved", open: [] };
  const open = openLabels(dischargeChecks(state, plan, findings));
  if (open.length) return { status: "refused", reason: "blocked", open };
  const { encounterId, requestId, approvedBy } = command;
  return { status: "discharged", encounterId, requestId, approvedBy, dischargedAt: at.toISOString(), savedMinutes: minutesSaved(fitAt, at) };
}

export function discharge(encounter: Encounter, patient: Patient, fitAt: Date, at: Date): Encounter {
  const state = encounter.discharge ?? EMPTY_DISCHARGE;
  const tasks = dischargeTasks(patient, state, planFor(patient), at).filter(t => !encounter.tasks.some(e => e.id === t.id));
  return { ...encounter, discharge: { ...state, dischargedAt: at.toISOString(), savedMinutes: minutesSaved(fitAt, at) }, tasks: [...encounter.tasks, ...tasks] };
}
