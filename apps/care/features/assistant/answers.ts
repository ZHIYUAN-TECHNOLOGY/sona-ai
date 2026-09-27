import type { Discharged } from "../discharge/lines";
import { DOCTORS, matchDoctors, type Doctor } from "../doctors/data";
import { away, dayLabel } from "../follow-ups/lines";

/**
 * Ask Sona Care without a model: up to three questions drawn from the patient's own plan, each with
 * its answer built only from that plan's words (medicines, leaflet, follow-up), and the source it
 * came from. Anything else goes to the care team; urgent words put the 999 line first.
 * ponytail: fixed question templates; a model grounded on the same plan replaces them later.
 */
export type PlanLike = Pick<Discharged, "medicines" | "leaflets">;
export type Visit = { title: string; date: Date | string; why?: string; inDays?: number };
/** `kind` picks the suggestion row's icon: a missed dose, a medicine, a visit. */
export type Asked = { question: string; answer: string; source: string; kind: "dose" | "medicine" | "visit" };

const PLAN = "From your discharge plan";
const time = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h! % 12 || 12}:${String(m).padStart(2, "0")} ${h! < 12 ? "AM" : "PM"}`;
};
/** Ends a plan line as a sentence. */
const end = (s: string) => /[.!?]$/.test(s) ? s : `${s}.`;
const list = (xs: string[]) => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
/** The English leaflet's sentences that mention a missed dose, if the plan has any. */
const missWords = (plan: PlanLike) => (plan.leaflets.find(l => l.language === "en")?.text ?? "")
  .split(/(?<=[.!?])\s+/).filter(s => /\b(miss|missed|forget|forgot)\b/i.test(s));

function missed(plan: PlanLike, name: string): Asked | undefined {
  const { medicines: m } = plan;
  const med = [...m.new, ...m.changed, ...m.continue].find(x => x.name === name);
  if (!med) return undefined;
  const said = missWords(plan);
  const usual = [med.take, med.at?.length && `at ${list(med.at.map(time))}`].filter(Boolean).join(", ");
  const answer = said.length
    ? `Your plan says: ${said.join(" ")} Never take two doses at once to make up for one.`
    : `Your plan doesn't say what to do if you miss a dose of ${med.name}, so ask your care team. Never take two doses at once to make up for one.${usual ? ` Your usual dose: ${usual}.` : ""}`;
  return { question: `What if I miss a dose of ${med.name}?`, answer, source: said.length ? PLAN : `From your ${med.name} instructions`, kind: "dose" };
}

/**
 * The questions to offer (at most three), in order: a missed dose of the next scheduled medicine (or
 * the first one on a schedule), what a new medicine is for (or what changed with a changed one), and
 * when the next visit is.
 */
export function suggestions(plan: PlanLike | undefined, visit: Visit | undefined, nextMed?: string): Asked[] {
  const out: (Asked | undefined)[] = [];
  if (plan) {
    const { medicines: m } = plan;
    const scheduled = nextMed ?? [...m.new, ...m.changed, ...m.continue].find(x => x.at?.length)?.name;
    if (scheduled) out.push(missed(plan, scheduled));
    const fresh = m.new[0], changed = m.changed[0];
    if (fresh) out.push({ question: `What is ${fresh.name} for?`, answer: `Your plan says: ${end(fresh.line)}${fresh.take ? ` Take ${end(fresh.take)}` : ""}`, source: `From your ${fresh.name} instructions`, kind: "medicine" });
    else if (changed) out.push({ question: `What changed with ${changed.name}?`, answer: `Your plan says: ${end(changed.line)}`, source: `From your ${changed.name} instructions`, kind: "medicine" });
  }
  if (visit) {
    const when = `${dayLabel(visit.date)}${visit.inDays === undefined ? "" : ` (${away(visit.inDays)})`}`;
    out.push({ question: "When is my next visit?", answer: `${visit.title}, ${when}.${visit.why ? ` ${end(visit.why)}` : ""}`, source: PLAN, kind: "visit" });
  }
  return out.filter((a): a is Asked => Boolean(a)).slice(0, 3);
}

/** Words that mean call 999 now, not wait for a reply: chest pain, breathing, fainting, bleeding and the like. */
const URGENT = /chest\b.{0,20}\b(pain|hurt|tight|pressure)|(pain|tight\w*|pressure) in (my )?chest|breath|faint|pass(ed|ing)?\s*out|collaps|unconscious|bleed|blood(?!\s*(pressure|sugar|tests?|results?))|lips?\b.{0,20}\bblue|blue\b.{0,20}\blips?|seizure|stroke|suicid|kill myself|end my life/i;
export const urgent = (text: string) => URGENT.test(text);

/** The one honest reply to free text while there is no model. */
export const NO_ANSWER = "I can't answer that yet. Send it to your care team?";

/** What the plan says the patient was treated for ("chest infection"), from the English leaflet's "treated for …". */
export function conditionOf(plan: PlanLike | undefined) {
  const text = plan?.leaflets.find(l => l.language === "en")?.text ?? "";
  return /treated for (?:an? )?([^.,;]+)/i.exec(text)?.[1]?.trim().toLowerCase() || undefined;
}

/** The suggestion row that finds a doctor for the plan's condition. */
export const doctorQuestion = (condition: string) => `Find a doctor for my ${condition}`;

/** "Find me a doctor", "best heart specialist", "which doctor should I see": a question asking for a doctor. */
const DOCTOR = /\b(doctors?|specialists?|dr)\b/i, ASKING = /\b(find|best|good|recommend|which|who|see|book|need|looking|suggest)\b/i;
export const wantsDoctor = (text: string) => DOCTOR.test(text) && ASKING.test(text);

/**
 * What Sona says to a question: the plan's answer when it is one of the plan's own questions; 1–3 sample
 * doctors for a doctor question (matched on its words, else the plan's condition, else the care team);
 * the one honest "send it to your care team" for anything else. Urgent words win over everything.
 */
export type Reply =
  | { kind: "plan"; asked: Asked }
  | { kind: "doctors"; doctors: Doctor[]; text: string }
  | { kind: "none"; urgent: boolean };

export function reply(question: string, asks: Asked[], condition?: string): Reply {
  const q = question.trim(), lower = q.toLowerCase();
  if (urgent(q)) return { kind: "none", urgent: true };
  const asked = asks.find(a => a.question.toLowerCase() === lower);
  if (asked) return { kind: "plan", asked };
  if (!wantsDoctor(q)) return { kind: "none", urgent: false };
  const own = matchDoctors(q), planned = condition ? matchDoctors(condition) : [];
  const about = condition && (!own.length || lower.includes(condition)) && planned.length ? condition : undefined;
  const doctors = (own.length ? own : planned.length ? planned : DOCTORS.filter(d => d.careTeam)).slice(0, 3);
  const lead = doctors.length === 1 ? "Here is a sample doctor" : "Here are sample doctors";
  return { kind: "doctors", doctors, text: `${lead} who may help${about ? ` with your ${about}` : ""}. Ask your care team before you book.` };
}

/** An answer split into its lead sentence (shown bold) and the rest; "Dr." never ends a sentence. */
export function leadOf(text: string): [string, string] {
  const m = /^(.*?(?<!\bDr)[.!?])\s+(?=\S)/.exec(text);
  return m ? [m[1]!, text.slice(m[0].length)] : [text, ""];
}

/** The words to read aloud (and show) for a reply: the answer, the doctors by name, or the honest no. */
export function spoken(r: Reply) {
  if (r.kind === "plan") return r.asked.answer;
  if (r.kind === "doctors") return `${r.text} ${list(r.doctors.map(d => `${d.name} (${d.specialty})`))}.`;
  return r.urgent ? `If this is happening now, call 999. ${NO_ANSWER}` : NO_ANSWER;
}
