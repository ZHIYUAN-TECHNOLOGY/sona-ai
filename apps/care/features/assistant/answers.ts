import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { formatDate, tFor, type Lang } from "@/lib/i18n";
import { listOf, type Discharged } from "../discharge/lines";
import type { Doctor } from "../doctors/data";
import { away, dayLabel } from "../follow-ups/lines";
import "./strings";

/**
 * Ask Sona Care: any question, answered by the model (care.ask): their own care from their plan, anything else
 * from general knowledge, marked as such. Up to three suggested questions come from their plan, with an
 * authored answer built from the plan's words (medicines, leaflet, follow-up) for when no model is on.
 * Doctor questions search the hospital's directory; urgent words put the 999 line first.
 */
export type PlanLike = Pick<Discharged, "medicines" | "leaflets">;
export type Visit = { title: string; date: Date | string; why?: string; inDays?: number };
/** `kind` picks the suggestion row's icon: a missed dose, a medicine, a visit. */
export type Asked = { question: string; answer: string; source: string; kind: "dose" | "medicine" | "visit" };

const MYT = 8 * 3600_000;
/** "8:00 AM" ("8:00 PG", "上午8:00") from the plan's "HH:MM" (already Malaysia time). */
const time = (hhmm: string, lang: Lang) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return formatDate(lang, Date.UTC(2000, 0, 1, h, m) - MYT, "time");
};
/** Sentences run on with a space, or none in Chinese. */
const sp = (lang: Lang) => lang === "zh" ? "" : " ";
/** Ends a plan line as a sentence. */
const end = (s: string, lang: Lang = "en") => /[.!?。！？]$/.test(s) ? s : `${s}${lang === "zh" ? "。" : "."}`;
/** The leaflet's sentences that mention a missed dose (in the patient's language, else English), if the plan has any. */
const missWords = (plan: PlanLike, lang: Lang) => ((plan.leaflets.find(l => l.language === lang) ?? plan.leaflets.find(l => l.language === "en"))?.text ?? "")
  .split(/(?<=[.!?])\s+|(?<=[。！？])/).map(s => s.trim()).filter(s => /\b(miss|missed|forget|forgot|terlupa|tertinggal|terlepas)\b|忘|漏/i.test(s));

function missed(plan: PlanLike, name: string, lang: Lang): Asked | undefined {
  const t = tFor(lang), { medicines: m } = plan;
  const med = [...m.new, ...m.changed, ...m.continue].find(x => x.name === name);
  if (!med) return undefined;
  const said = missWords(plan, lang);
  const usual = [med.take, med.at?.length && t("ask.at", { times: listOf(med.at.map(a => time(a, lang)), lang) })].filter(Boolean).join(t("dis.comma"));
  const answer = said.length
    ? `${t("ask.planSays", { text: said.join(sp(lang)) })}${sp(lang)}${t("ask.never")}`
    : `${t("ask.noMissInfo", { name: med.name })}${sp(lang)}${t("ask.never")}${usual ? `${sp(lang)}${t("ask.usual", { usual })}` : ""}`;
  return { question: t("ask.qMiss", { name: med.name }), answer, source: said.length ? t("ask.plan") : t("ask.from", { name: med.name }), kind: "dose" };
}

/**
 * The questions to offer (at most three), in order: a missed dose of the next scheduled medicine (or the
 * first one still on a schedule, never a finished course), what a new medicine is for (or what changed with
 * a changed one), and when the next visit is. The fixed words are in the patient's language; the plan's own lines as written.
 */
export function suggestions(plan: PlanLike | undefined, visit: Visit | undefined, nextMed?: string, lang: Lang = "en"): Asked[] {
  const t = tFor(lang), out: (Asked | undefined)[] = [];
  if (plan) {
    const { medicines: m } = plan;
    const scheduled = nextMed ?? [...m.new, ...m.changed, ...m.continue].find(x => x.at?.length && !x.finished)?.name;
    if (scheduled) out.push(missed(plan, scheduled, lang));
    const fresh = m.new[0], changed = m.changed[0];
    if (fresh) out.push({ question: t("ask.qFor", { name: fresh.name }), answer: `${t("ask.planSays", { text: end(fresh.line, lang) })}${fresh.take ? `${sp(lang)}${t("ask.take", { take: end(fresh.take, lang) })}` : ""}`, source: t("ask.from", { name: fresh.name }), kind: "medicine" });
    else if (changed) out.push({ question: t("ask.qChanged", { name: changed.name }), answer: t("ask.planSays", { text: end(changed.line, lang) }), source: t("ask.from", { name: changed.name }), kind: "medicine" });
  }
  if (visit) {
    const when = `${dayLabel(visit.date, lang)}${visit.inDays === undefined ? "" : ` (${away(visit.inDays, lang)})`}`;
    out.push({ question: t("ask.qVisit"), answer: `${visit.title}${t("dis.comma")}${end(when, lang)}${visit.why ? `${sp(lang)}${end(visit.why, lang)}` : ""}`, source: t("ask.plan"), kind: "visit" });
  }
  return out.filter((a): a is Asked => Boolean(a)).slice(0, 3);
}

/** Words that mean call 999 now, not wait for a reply: chest pain, breathing, fainting, bleeding and the like (English, Malay, Chinese). */
const URGENT = /chest\b.{0,20}\b(pain|hurt|tight|pressure)|(pain|tight\w*|pressure) in (my )?chest|breath|faint|pass(ed|ing)?\s*out|collaps|unconscious|bleed|blood(?!\s*(pressure|sugar|tests?|results?))|lips?\b.{0,20}\bblue|blue\b.{0,20}\blips?|seizure|stroke|suicid|kill myself|end my life/i;
const URGENT_MS_ZH = /sakit dada|dada (sakit|sesak|ketat)|sesak nafas|susah (nak )?bernafas|tak boleh bernafas|tidak boleh bernafas|pengsan|pitam|tidak sedarkan diri|berdarah|pendarahan|bibir biru|sawan|strok|angin ahmar|bunuh diri|胸痛|胸口痛|胸闷|呼吸困难|喘不过气|晕倒|昏倒|昏迷|出血|流血|嘴唇发紫|抽搐|中风|自杀|不想活/i;
export const urgent = (text: string) => URGENT.test(text) || URGENT_MS_ZH.test(text);

/** The one honest reply to free text while there is no model. */
export const NO_ANSWER = "I can't answer that yet. Send it to your care team?";
export const noAnswer = (lang: Lang = "en") => tFor(lang)("ask.noAnswer");

/** What the plan says the patient was treated for ("chest infection"), from the English leaflet's "treated for …". */
export function conditionOf(plan: PlanLike | undefined) {
  const text = plan?.leaflets.find(l => l.language === "en")?.text ?? "";
  return /treated for (?:an? )?([^.,;]+)/i.exec(text)?.[1]?.trim().toLowerCase() || undefined;
}

/** The suggestion row that finds a doctor for the plan's condition. */
export const doctorQuestion = (condition: string, lang: Lang = "en") => tFor(lang)("ask.findDoctor", { condition });

/** "Find me a doctor", "best heart specialist", "which doctor should I see" (or "cari doktor", "找医生"): a question asking for a doctor. */
const DOCTOR = /\b(doctors?|specialists?|dr|doktor|pakar)\b|医生|专科/i, ASKING = /\b(find|best|good|recommend|which|who|see|book|need|looking|suggest|cari|terbaik|siapa|jumpa|perlu|cadang|tempah)\b|找|推荐|哪|看|需要|预约/i;
export const wantsDoctor = (text: string) => DOCTOR.test(text) && ASKING.test(text);

/**
 * What Sona says to a question. Urgent words win: the 999 line, whatever the server says, and the question still goes
 * to it (care.ask), because that is what tells the care team; a failed call leaves the 999 line. A doctor question: 1–3
 * doctors from the hospital's directory (care.doctors.list), found by its words, else by the plan's
 * condition, else the care team. Anything else, the plan's own questions too, is answered by the model
 * from the patient's plan (care.ask); when no model is on (a fixture) or the call fails, a plan question
 * gets its authored answer and anything else the one honest "send it to your care team". While the model
 * starts, that reply carries `waking` (whole minutes until it is ready), shown as `startingLine`. A question that
 * reports a problem carries `careTeam` once the server has made the care team's task, model or no model.
 */
/** The care team's flagged task and Sona's line saying so ("I've let your care team know.", in the plan's language). */
export type CareTeam = { taskId: string; title: string; line: string };
export type Reply =
  | { kind: "plan"; asked: Asked; waking?: number; careTeam?: CareTeam }
  | { kind: "doctors"; doctors: Doctor[]; text: string }
  | { kind: "none"; urgent: boolean; waking?: number; careTeam?: CareTeam };
export type PlanAnswer = Awaited<ReturnType<AppRouterClient["care"]["ask"]>>;
/** The calls an answer may make: care.ask with the question, and care.doctors.list with a search (none for the whole directory). */
export type Api = { ask: (question: string) => Promise<PlanAnswer>; doctors: (search?: string) => Promise<Doctor[]> };
const NONE = { kind: "none", urgent: false } as const, CALL_999 = { kind: "none", urgent: true } as const;

export async function answer(question: string, asks: Asked[], api: Api, condition?: string, lang: Lang = "en"): Promise<Reply> {
  const q = question.trim(), lower = q.toLowerCase();
  if (urgent(q)) return api.ask(q).then(a => ({ ...CALL_999, ...toldOf(a) }), () => CALL_999);
  const asked = asks.find(a => a.question.toLowerCase() === lower);
  if (!asked && wantsDoctor(q)) return doctorsFor(q, api.doctors, condition, lang).catch(() => NONE);
  const fallback = asked ? { kind: "plan" as const, asked } : NONE;
  return api.ask(q).then(a => ({ ...(a.source === "model" ? fromModel(a, lang) : { ...fallback, ...wakingOf(a) }), ...toldOf(a) }), () => fallback);
}

/** The server's `careTeam`, there only once the task is made (read loosely: older servers never send it). */
function toldOf(a: PlanAnswer) {
  const told = (a as { careTeam?: CareTeam }).careTeam;
  return told?.line ? { careTeam: told } : {};
}

/** The server's `waking` on a sample while the model starts (read loosely: older servers never send it). */
function wakingOf(a: PlanAnswer) {
  const n = (a as { waking?: unknown }).waking;
  return typeof n === "number" && n > 0 ? { waking: Math.ceil(n) } : {};
}
/** "Sona Care is starting up, about 3 min" in the patient's language. */
export const startingLine = (minutes: number, lang: Lang = "en") => tFor(lang)(minutes <= 1 ? "ask.startingSoon" : "ask.starting", { n: minutes });

async function doctorsFor(q: string, find: Api["doctors"], condition: string | undefined, lang: Lang): Promise<Reply> {
  const [own, planned] = await Promise.all([find(q), condition ? find(condition) : []]);
  const about = condition && (!own.length || q.toLowerCase().includes(condition)) && planned.length ? condition : undefined;
  const doctors = (own.length ? own : planned.length ? planned : (await find()).filter(d => d.careTeam)).slice(0, 3);
  if (!doctors.length) return NONE;
  const key = `ask.doctors${doctors.length === 1 ? "1" : "N"}${about ? "About" : ""}`;
  return { kind: "doctors", doctors, text: tFor(lang)(key, { about: about ?? "" }) };
}

/**
 * A model's care.ask answer as a reply. Any question gets its answer (no content limit): from their plan, it says where
 * from; otherwise it is marked as a general answer, not from their records. A warning sign is the 999 card.
 */
function fromModel(a: PlanAnswer, lang: Lang): Exclude<Reply, { kind: "doctors" }> {
  if (!a.answer) return NONE;
  if (a.urgent) return CALL_999;
  const t = tFor(lang);
  const source = a.grounded ? a.from ? t("ask.fromModel", { from: a.from }) : t("ask.plan") : t("ask.general");
  return { kind: "plan", asked: { question: "", answer: a.answer, source, kind: "medicine" } };
}

/** An answer split into its lead sentence (shown bold) and the rest; "Dr." never ends a sentence. */
export function leadOf(text: string): [string, string] {
  // A Chinese full stop ends a sentence with no space after it.
  const m = /^(.*?(?:(?<!\bDr)[.!?](?=\s+\S)|[。！？](?=\S)))\s*/.exec(text);
  return m ? [m[1]!, text.slice(m[0].length)] : [text, ""];
}

/**
 * A reply's words as the chat shows them: the answer, the doctors' line, or the honest no. Sona's "I've let your care
 * team know." follows an answer, and stands in for the no: that one offers to send what has already reached them.
 */
export function shown(r: Reply, lang: Lang = "en") {
  if (r.kind === "doctors") return r.text;
  const told = r.careTeam?.line;
  if (r.kind === "plan") return told ? `${r.asked.answer}${sp(lang)}${told}` : r.asked.answer;
  return told ?? noAnswer(lang);
}

/** The words to read aloud for a reply: what the chat shows, the doctors by name, and the 999 line first (the chat has its card for that). */
export function spoken(r: Reply, lang: Lang = "en") {
  if (r.kind === "doctors") return `${r.text}${sp(lang)}${end(listOf(r.doctors.map(d => `${d.name} (${d.specialty})`), lang), lang)}`;
  return r.kind === "none" && r.urgent ? `${tFor(lang)("ask.call999First")}${sp(lang)}${shown(r, lang)}` : shown(r, lang);
}
