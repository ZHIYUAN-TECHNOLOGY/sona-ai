import type { Discharged } from "../discharge/lines";
import { away, dayLabel } from "../follow-ups/lines";

/**
 * Ask Sona Care without a model: up to three questions drawn from the patient's own plan, each with
 * its answer built only from that plan's words (medicines, leaflet, follow-up), and the source it
 * came from. Anything else goes to the care team; urgent words put the 999 line first.
 * ponytail: fixed question templates; a model grounded on the same plan replaces them later.
 */
export type PlanLike = Pick<Discharged, "medicines" | "leaflets">;
export type Visit = { title: string; date: Date | string; why?: string; inDays?: number };
export type Asked = { question: string; answer: string; source: string };

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
  return { question: `What if I miss a dose of ${med.name}?`, answer, source: said.length ? PLAN : `From your ${med.name} instructions` };
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
    if (fresh) out.push({ question: `What is ${fresh.name} for?`, answer: `Your plan says: ${end(fresh.line)}${fresh.take ? ` Take ${end(fresh.take)}` : ""}`, source: `From your ${fresh.name} instructions` });
    else if (changed) out.push({ question: `What changed with ${changed.name}?`, answer: `Your plan says: ${end(changed.line)}`, source: `From your ${changed.name} instructions` });
  }
  if (visit) {
    const when = `${dayLabel(visit.date)}${visit.inDays === undefined ? "" : ` (${away(visit.inDays)})`}`;
    out.push({ question: "When is my next visit?", answer: `${visit.title}, ${when}.${visit.why ? ` ${end(visit.why)}` : ""}`, source: PLAN });
  }
  return out.filter((a): a is Asked => Boolean(a)).slice(0, 3);
}

/** Words that mean call 999 now, not wait for a reply: chest pain, breathing, fainting, bleeding and the like. */
const URGENT = /chest\b.{0,20}\b(pain|hurt|tight|pressure)|(pain|tight\w*|pressure) in (my )?chest|breath|faint|pass(ed|ing)?\s*out|collaps|unconscious|bleed|blood(?!\s*(pressure|sugar|tests?|results?))|lips?\b.{0,20}\bblue|blue\b.{0,20}\blips?|seizure|stroke|suicid|kill myself|end my life/i;
export const urgent = (text: string) => URGENT.test(text);

/** The one honest reply to free text while there is no model. */
export const NO_ANSWER = "I can't answer that yet. Send it to your care team?";
