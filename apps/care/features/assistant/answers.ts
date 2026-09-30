import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { formatDate, tFor, type Lang } from "@/lib/i18n";
import { listOf, type Discharged } from "../discharge/lines";
import type { Doctor } from "../doctors/data";
import { away, dayLabel } from "../follow-ups/lines";
import "./strings";

/**
 * Ask Sona Care: up to three questions drawn from the patient's own plan, each answered by the model
 * from that plan (care.ask), with an authored answer built only from the plan's words (medicines,
 * leaflet, follow-up) for when no model is on. Doctor questions search the hospital's directory.
 * Anything else the plan does not answer goes to the care team; urgent words put the 999 line first.
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
 * The questions to offer (at most three), in order: a missed dose of the next scheduled medicine (or
 * the first one on a schedule), what a new medicine is for (or what changed with a changed one), and
 * when the next visit is. The fixed words are in the patient's language; the plan's own lines as written.
 */
export function suggestions(plan: PlanLike | undefined, visit: Visit | undefined, nextMed?: string, lang: Lang = "en"): Asked[] {
  const t = tFor(lang), out: (Asked | undefined)[] = [];
  if (plan) {
    const { medicines: m } = plan;
    const scheduled = nextMed ?? [...m.new, ...m.changed, ...m.continue].find(x => x.at?.length)?.name;
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
 * What Sona says to a question. Urgent words win: the 999 line, nothing asked. A doctor question: 1–3
 * doctors from the hospital's directory (care.doctors.list), found by its words, else by the plan's
 * condition, else the care team. Anything else, the plan's own questions too, is answered by the model
 * from the patient's plan (care.ask); when no model is on (a fixture) or the call fails, a plan question
 * gets its authored answer and anything else the one honest "send it to your care team".
 */
export type Reply =
  | { kind: "plan"; asked: Asked }
  | { kind: "doctors"; doctors: Doctor[]; text: string }
  | { kind: "none"; urgent: boolean };
export type PlanAnswer = Awaited<ReturnType<AppRouterClient["care"]["ask"]>>;
/** The calls an answer may make: care.ask with the question, and care.doctors.list with a search (none for the whole directory). */
export type Api = { ask: (question: string) => Promise<PlanAnswer>; doctors: (search?: string) => Promise<Doctor[]> };
const NONE: Reply = { kind: "none", urgent: false };

export async function answer(question: string, asks: Asked[], api: Api, condition?: string, lang: Lang = "en"): Promise<Reply> {
  const q = question.trim(), lower = q.toLowerCase();
  if (urgent(q)) return { kind: "none", urgent: true };
  const asked = asks.find(a => a.question.toLowerCase() === lower);
  if (!asked && wantsDoctor(q)) return doctorsFor(q, api.doctors, condition, lang).catch(() => NONE);
  const fallback: Reply = asked ? { kind: "plan", asked } : NONE;
  return api.ask(q).then(a => a.source === "model" ? fromModel(a, lang) : fallback, () => fallback);
}

async function doctorsFor(q: string, find: Api["doctors"], condition: string | undefined, lang: Lang): Promise<Reply> {
  const [own, planned] = await Promise.all([find(q), condition ? find(condition) : []]);
  const about = condition && (!own.length || q.toLowerCase().includes(condition)) && planned.length ? condition : undefined;
  const doctors = (own.length ? own : planned.length ? planned : (await find()).filter(d => d.careTeam)).slice(0, 3);
  if (!doctors.length) return NONE;
  const key = `ask.doctors${doctors.length === 1 ? "1" : "N"}${about ? "About" : ""}`;
  return { kind: "doctors", doctors, text: tFor(lang)(key, { about: about ?? "" }) };
}

/** A model's care.ask answer as a reply: grounded in the plan (with where from), or the honest no (urgent when the model heard a warning sign). */
function fromModel(a: PlanAnswer, lang: Lang): Reply {
  if (!a.answer) return NONE;
  if (!a.grounded) return { kind: "none", urgent: a.urgent };
  const t = tFor(lang);
  return { kind: "plan", asked: { question: "", answer: a.answer, source: a.from ? t("ask.fromModel", { from: a.from }) : t("ask.plan"), kind: "medicine" } };
}

/** An answer split into its lead sentence (shown bold) and the rest; "Dr." never ends a sentence. */
export function leadOf(text: string): [string, string] {
  // A Chinese full stop ends a sentence with no space after it.
  const m = /^(.*?(?:(?<!\bDr)[.!?](?=\s+\S)|[。！？](?=\S)))\s*/.exec(text);
  return m ? [m[1]!, text.slice(m[0].length)] : [text, ""];
}

/** The words to read aloud (and show) for a reply: the answer, the doctors by name, or the honest no. */
export function spoken(r: Reply, lang: Lang = "en") {
  if (r.kind === "plan") return r.asked.answer;
  if (r.kind === "doctors") return `${r.text}${sp(lang)}${end(listOf(r.doctors.map(d => `${d.name} (${d.specialty})`), lang), lang)}`;
  return r.urgent ? `${tFor(lang)("ask.call999First")}${sp(lang)}${noAnswer(lang)}` : noAnswer(lang);
}
