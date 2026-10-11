import { toneOf, type ActionCard, type AnswerCard, type Tone } from "@sona-ai/domain/answer-parts";

/**
 * An answer's cards as Sona Pro shows them (docs/answer-parts.md): facts the server read from the record become list rows,
 * a warning, steps, or the one drafted task to review. Pure, so the shapes are tested without React.
 */
type RowCard = Extract<AnswerCard, { type: "medicine" | "result" | "reading" | "appointment" }>;
type TaskCard = Extract<ActionCard, { do: "createTask" }>;
/** What Pro shows: consecutive facts in one list, then each warning, steps or task on its own. A doctor and the patient's own actions are Sona Care's. */
export type CardBlock = { rows: RowCard[] } | Extract<AnswerCard, { type: "warning" | "steps" }> | TaskCard;

const ROWS = new Set(["medicine", "result", "reading", "appointment"]);
export function cardBlocks(cards: AnswerCard[]): CardBlock[] {
  const out: CardBlock[] = [];
  for (const card of cards) {
    if (ROWS.has(card.type)) {
      const last = out.at(-1);
      if (last && "rows" in last) last.rows.push(card as RowCard); else out.push({ rows: [card as RowCard] });
    } else if (card.type === "warning" || card.type === "steps" || (card.type === "action" && card.do === "createTask")) out.push(card as CardBlock);
  }
  return out;
}

const FLAG = { high: "High", low: "Low", normal: "Normal", critical: "Critical" } as const;
const STATUS = { upcoming: "Upcoming", "due-soon": "Due soon", requested: "Requested", confirmed: "Confirmed", declined: "Declined", attended: "Attended", missed: "Missed" } as const;
/** A moment in Malaysia time, as the clinic reads it: "Sun 11 Oct, 08:00". */
const MYT = { timeZone: "Asia/Kuala_Lumpur" } as const;
export const when = (at: string) => { const d = new Date(at); return `${d.toLocaleDateString("en-GB", { ...MYT, weekday: "short", day: "numeric", month: "short" })}, ${d.toLocaleTimeString("en-GB", { ...MYT, hour: "2-digit", minute: "2-digit" })}`; };
type Part = string | false | undefined;
const line = (...parts: Part[]) => parts.filter(Boolean).join(" · ");
const say = (...parts: Part[]) => parts.filter(Boolean).join(", ");

/**
 * A fact as a list row: its name, its value on the right, then what it means in its tone, the flag or status always a
 * word; `label` reads the whole row as one sentence ("Potassium 3.1 mmol/L, low, usual range 3.5 to 5.1 mmol/L").
 */
export function rowOf(card: RowCard): { title: string; detail: string; trailing?: string; tone: Tone; label: string } {
  const tone = toneOf(card);
  switch (card.type) {
    case "medicine": {
      const facts = [card.dose, card.times?.join(", "), card.how, card.note, card.source];
      return { title: card.name, detail: line(...facts), tone, label: say(card.name, ...facts) };
    }
    case "result": case "reading": {
      const name = card.type === "result" ? card.test : card.label, value = [card.value, card.unit].filter(Boolean).join(" ");
      const flag = card.flag && FLAG[card.flag], range = card.type === "result" && card.range;
      const detail = line(flag, range && `usual ${range}`, card.at && when(card.at), card.type === "result" && card.source);
      return { title: name, trailing: value, detail, tone, label: say(`${name} ${value}`, flag?.toLowerCase(), range && `usual range ${range}`, card.at && when(card.at), card.type === "result" && card.source) };
    }
    case "appointment": {
      const detail = line(STATUS[card.status], when(card.when), card.where);
      return { title: card.title, detail, tone, label: say(card.title, STATUS[card.status].toLowerCase(), when(card.when), card.where) };
    }
  }
}

/**
 * The op a drafted task runs once confirmed (the answer's review card): `task-new:` and the tasks.create input without
 * its requestId, as URI-encoded JSON. The app adds the requestId (useRunOp), so asking again after a lost reply keeps one task.
 */
export const taskOp = (payload: TaskCard["payload"]) => `task-new:${encodeURIComponent(JSON.stringify(payload))}`;
/** A task-new op's task, or undefined when it does not read as one (the server checks it again). */
export function taskOfOp(arg: string): TaskCard["payload"] | undefined {
  try {
    const p = JSON.parse(decodeURIComponent(arg)) as Partial<TaskCard["payload"]>;
    const ok = [p.encounterId, p.title, p.owner].every(v => typeof v === "string" && v.trim()) && (p.due === undefined || /^\d{4}-\d{2}-\d{2}$/.test(String(p.due)));
    return ok ? { encounterId: p.encounterId!, title: p.title!.trim(), owner: p.owner!.trim(), ...p.due && { due: p.due } } : undefined;
  } catch { return undefined; }
}
