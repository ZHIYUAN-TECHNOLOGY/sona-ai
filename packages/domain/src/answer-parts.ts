import { z } from "zod";
import type { Doctor } from "./doctors";

/**
 * What a Sona answer carries besides its words, the same on every surface (Sona Care and Sona Pro, iPhone and web):
 * the words to colour (`marks`), cards built from the database (`cards`) and, when the Clef fast lane took the turn,
 * how it read it (`lane`). Each rides as its own optional field on an answer (care.ask, ask.free, a call's
 * `sona_turn`), so an old build that reads none of them still shows the answer as before. docs/answer-parts.md has
 * which surface renders what, and the colour table. Pure TS and zod, no React, so the server and every app import it.
 */

/**
 * The kinds of words coloured in an answer, by what they mean to the reader. The model chooses them (its marks); the
 * apps never decide by word lists when it did. Each kind keeps one hue everywhere (`MARK_HUE`).
 * - warning: must not be missed: an emergency sign, an allergy, a critical or clearly abnormal result, calling 999.
 * - caution: unconfirmed, pending or missing, or a value just out of range: something to check.
 * - medicine: a medicine, drug class or treatment, by name (never its dose).
 * - dose: how much and when: a dose or amount, how often, for how long, and a visit, check-in, date or time.
 * - condition: a diagnosis or condition.
 * - symptom: a symptom or sign.
 * - test: a test or measurement, with its value when the answer gives one.
 */
export const MARK_KINDS = ["warning", "caution", "medicine", "dose", "condition", "symptom", "test"] as const;
export type MarkKind = (typeof MARK_KINDS)[number];
export type Mark = { text: string; kind: MarkKind };

/** Older names for the same kinds: Sona Pro's ask.free before 11 Oct (alert, finding) and Sona Care's prompt word "when". */
const OLD_KINDS: Record<string, MarkKind> = { alert: "warning", finding: "condition", when: "dose" };

/** A mark's kind as it is now, from any server old or new; undefined for a kind no one knows (that word stays plain). */
export function markKindOf(kind: unknown): MarkKind | undefined {
  if (typeof kind !== "string") return undefined;
  return (MARK_KINDS as readonly string[]).includes(kind) ? kind as MarkKind : OLD_KINDS[kind];
}

/**
 * An answer's marks as the apps colour them: each kind read by `markKindOf`, unknown kinds and empty words left out.
 * Undefined when the answer has no marks at all, so Sona Care's word lists still stand in for an authored answer;
 * an empty list means the model chose to colour nothing.
 */
export function marksOf(marks: unknown): Mark[] | undefined {
  if (!Array.isArray(marks)) return undefined;
  return marks.flatMap(m => {
    const kind = markKindOf(m?.kind), text = typeof m?.text === "string" ? m.text.trim() : "";
    return kind && text ? [{ text: text.slice(0, 80), kind }] : [];
  }).slice(0, 24);
}

/**
 * The hue each kind is drawn in, named rather than given as a value: each surface maps it to its own palette
 * (docs/answer-parts.md, colour table). Five hues and ink, each with one meaning: red must not miss, amber check,
 * blue a medicine, violet how much and when, teal what the patient has. A test is ink, emphasised by weight only.
 */
export type Hue = "red" | "amber" | "blue" | "violet" | "teal" | "ink";
export const MARK_HUE: Record<MarkKind, Hue> = { warning: "red", caution: "amber", medicine: "blue", dose: "violet", condition: "teal", symptom: "teal", test: "ink" };

const text = (max: number) => z.string().trim().min(1).max(max);
/** A moment as ISO 8601 (`date.toISOString()`); each app shows it in its own language and Malaysia time. */
const moment = z.iso.datetime({ offset: true });
/** Where a fact is from, as the screen says it, in the answer's language ("Your discharge plan", "Lab result"). */
const source = text(80);
/** A result or reading against its usual range; "critical" is past the lab's call-now limit (critical.ts). */
const flag = z.enum(["high", "low", "normal", "critical"]);

const medicineCard = z.object({
  type: z.literal("medicine"), name: text(80), dose: text(80).optional(), how: text(160).optional(),
  /** The plan's times, "08:00" in Malaysia time, as DischargePlan medicines give them. */
  times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).max(8).optional(), note: text(160).optional(), source,
});
const resultCard = z.object({
  type: z.literal("result"), test: text(80), value: text(40), unit: text(20).optional(), flag: flag.optional(),
  /** The usual range as words ("3.5 to 5.1 mmol/L"), from lab-ranges.ts or the lab. */
  range: text(60).optional(), at: moment.optional(), source,
});
const readingCard = z.object({ type: z.literal("reading"), label: text(60), value: text(40), unit: text(20), at: moment.optional(), flag: flag.optional() });
const appointmentCard = z.object({
  type: z.literal("appointment"), title: text(120), when: moment, where: text(120).optional(),
  /** A visit's (care.ts FollowUpStatus) or a booking request's (booking_requests.status). */
  status: z.enum(["upcoming", "due-soon", "requested", "confirmed", "declined", "attended", "missed"]),
});
const warningCard = z.object({ type: z.literal("warning"), level: z.enum(["urgent", "soon", "info"]), title: text(120), items: z.array(text(160)).max(8) });
const stepsCard = z.object({ type: z.literal("steps"), title: text(120), items: z.array(text(200)).min(1).max(8) });
/** A doctor from the hospital's directory, as Sona Care's doctor card shows one (its page opens by `id`). */
const doctorCard = z.object({ type: z.literal("doctor"), id: text(64), name: text(80), specialty: text(80), room: text(120), rating: z.number().min(0).max(5), careTeam: z.boolean().optional() }) satisfies
  z.ZodType<{ type: "doctor" } & Pick<Doctor, "id" | "name" | "specialty" | "room" | "rating" | "careTeam">>;

/**
 * Something Sona drafted for the person to confirm, never done before they do (UX rule 4): what it is (`title`,
 * `items`), what will happen (`what`), the button (`confirm`) and the receipt that replaces it (`done`). `payload` is
 * the input of the call the app makes on confirm, which checks it again: book is care.bookings.request, logDose
 * care.doses.take, logReading care.readings.add, createTask tasks.create and tellCareTeam care.messages.send
 * (the app adds `requestId` to the last two).
 */
const draft = { type: z.literal("action"), title: text(160), items: z.array(text(160)).max(6).optional(), what: text(200).optional(), confirm: text(40), done: text(160) };
const actionCard = z.discriminatedUnion("do", [
  z.object({ ...draft, do: z.literal("book"), payload: z.object({ doctorId: text(64), startsAt: moment, reason: text(200).optional() }) }),
  /** `key` is doses.ts doseKey(name, dueAt). */
  z.object({ ...draft, do: z.literal("logDose"), payload: z.object({ key: z.string().min(3).max(200) }) }),
  /** `kind` is one of care-readings.ts READING_KINDS; `value2` the lower number of a blood pressure. */
  z.object({ ...draft, do: z.literal("logReading"), payload: z.object({ kind: text(40), value: z.number(), value2: z.number().optional(), takenAt: moment.optional() }) }),
  z.object({ ...draft, do: z.literal("createTask"), payload: z.object({ encounterId: text(64), title: text(200), owner: text(80), due: z.iso.date().optional() }) }),
  z.object({ ...draft, do: z.literal("tellCareTeam"), payload: z.object({ text: text(2000) }) }),
]);

/**
 * A card in an answer, built by the server from the database (her plan, results, readings, visits, the directory),
 * never written by the model: the model's words say what it means, the card shows the facts and the next step.
 * Unknown fields are dropped, not refused, so a newer server's extra field keeps the card on an older app.
 */
export const answerCard = z.discriminatedUnion("type", [medicineCard, resultCard, readingCard, appointmentCard, warningCard, stepsCard, doctorCard, actionCard]);
export type AnswerCard = z.infer<typeof answerCard>;
export type ActionCard = Extract<AnswerCard, { type: "action" }>;

/** At most this many cards under one answer, of which at most one is an action (one feature surface, UX rule 6). */
export const MAX_CARDS = 6;
/** An answer's cards that this app can show: one it cannot read (an unknown type, a missing field) is left out, never the answer; a second action is left out too. */
export function cardsOf(cards: unknown): AnswerCard[] {
  if (!Array.isArray(cards)) return [];
  let action = false;
  return cards.flatMap(c => {
    const read = answerCard.safeParse(c);
    if (!read.success || (read.data.type === "action" && action)) return [];
    action ||= read.data.type === "action";
    return [read.data];
  }).slice(0, MAX_CARDS);
}

/** The tones every surface already draws (the ask catalogue's askTone, native `tone`, web rule rows): red, amber, green, neutral. */
export type Tone = "urgent" | "soon" | "good" | "calm";
/** A card's tone, from its own facts: critical or urgent red; out of range, waiting or missed amber; confirmed green; the rest neutral. */
export function toneOf(card: AnswerCard): Tone {
  if (card.type === "result" || card.type === "reading") return card.flag === "critical" ? "urgent" : card.flag === "high" || card.flag === "low" ? "soon" : "calm";
  if (card.type === "warning") return card.level === "urgent" ? "urgent" : card.level === "soon" ? "soon" : "calm";
  if (card.type === "appointment") return card.status === "confirmed" ? "good" : ["due-soon", "requested", "declined", "missed"].includes(card.status) ? "soon" : "calm";
  return "calm";
}

/**
 * The Clef fast lane's turns, and only these (Clef trial, 11 Oct): it never answers a medical question or decides an
 * emergency; those always go to Gemma and the 999 rules.
 */
export const LANE_INTENTS = { care: ["book_appointment", "next_appointment", "log_dose", "log_reading"], pro: ["create_task", "ward_overview"] } as const;
export const laneSchema = z.object({ intent: z.enum([...LANE_INTENTS.care, ...LANE_INTENTS.pro]), confidence: z.number().min(0).max(1), by: z.literal("clef-omni") });
/** Set only when the fast lane answered the turn without Gemma: what Clef read and how sure it was. For debugging and telemetry; not shown to patients. */
export type Lane = z.infer<typeof laneSchema>;

export type AnswerParts = { marks?: Mark[]; cards?: AnswerCard[]; lane?: Lane };
/** The parts of any answer an app was sent, read loosely (an older server sends none, a newer one may send more): what is left out is simply not shown. */
export function partsOf(answer: unknown): AnswerParts {
  const a = (answer ?? {}) as { marks?: unknown; cards?: unknown; lane?: unknown };
  const marks = marksOf(a.marks), cards = cardsOf(a.cards), lane = laneSchema.safeParse(a.lane);
  return { ...marks && { marks }, ...cards.length && { cards }, ...lane.success && { lane: lane.data } };
}
