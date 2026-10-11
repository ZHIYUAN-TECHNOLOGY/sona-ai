import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { Language } from "@sona-ai/domain/discharge";
import { slotWords, type Doctor } from "@sona-ai/domain/doctors";
import { languageOf } from "@sona-ai/domain/language";
import {
  convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, pruneMessages, stepCountIs, streamText, tool,
  type LanguageModel, type ModelMessage, type UIMessage, type UIMessageStreamWriter,
} from "ai";
import { z } from "zod";

import { BRAIN_MODEL, boxes, starting, wakingOf, type Baseten } from "../baseten-models";
import { LANGUAGE_NAME } from "../chat-models";
import type { Context, Library } from "../context";
import { CLEF_MODEL, emergencyOf } from "../decide";
import { citedSources, leafletHits, passagesIn, type Passage } from "../leaflets";
import { doctorsFor, requestBooking } from "../routers/bookings";
import { recordText } from "../routers/care-plan";
import { LINES, callNow } from "../voice-agent/answer";
import { tellCareTeam } from "../voice-agent/care-team";
import { textOf, type ChatMessageLike, type ChatMeta } from "./client";

/**
 * One turn of Ask Sona Care's chat agent (apps/server/src/agents/chat.ts): the conversation so far, trimmed (recentTurns),
 * goes to Sona Med (Gemma 4 on the brain box, through the same adapter as every other model call), which streams its
 * answer and may call tools that run the app's own server code: her record (recordText), the hospital's leaflets
 * (leafletHits), its doctors (doctorsFor), a booking request (requestBooking) and her care team (tellCareTeam). Founder
 * decision, 9 Oct: no limit on what Sona answers. What stays: the 999 line and a care-team task for an emergency she
 * reports now, honest labels (her record, a leaflet, or general), and the language she wrote in.
 */

/** Questions (with their answers) the model reads each turn, and the most words they may hold. */
export const MAX_TURNS = 20;
export const MAX_CHARS = 24_000;

/**
 * The last `maxTurns` questions and everything after each, dropping the oldest turns while they hold more than `maxChars`
 * of words (the last turn always stays). Always starts at a question.
 * ponytail: older turns are dropped, not remembered; Phase 2 summarises them (the Session API's compaction, docs/chat-agent.md).
 */
export function recentTurns<M extends ChatMessageLike>(messages: M[], maxTurns = MAX_TURNS, maxChars = MAX_CHARS): M[] {
  const starts = messages.flatMap((m, i) => m.role === "user" ? [i] : []);
  if (!starts.length) return [];
  const size = (from: number) => messages.slice(from).reduce((n, m) => n + textOf(m).length, 0);
  let i = Math.max(0, starts.length - maxTurns);
  while (i < starts.length - 1 && size(starts[i]!) > maxChars) i++;
  return messages.slice(starts[i]);
}

/**
 * Chat templates want the roles to alternate: a question left unanswered (a failed or stopped turn) joins the next one, and
 * an answer written over several steps (its tool calls pruned away) is one answer.
 */
export function alternating(messages: ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  const parts = (c: ModelMessage["content"]) => typeof c === "string" ? [{ type: "text" as const, text: c }] : c;
  for (const m of messages) {
    const last = out.at(-1);
    if (last && last.role === m.role && (m.role === "user" || m.role === "assistant")) last.content = [...parts(last.content), ...parts(m.content)] as never;
    else out.push({ ...m } as ModelMessage);
  }
  return out;
}

/** What the model reads before this turn: the recent turns, with earlier turns' tool calls and results pruned (a record read once is ~2,000 tokens). */
export async function historyFor(messages: UIMessage[]) {
  const model = await convertToModelMessages(recentTurns(messages), { ignoreIncompleteToolCalls: true });
  return alternating(pruneMessages({ messages: model, reasoning: "all", toolCalls: "before-last-message", emptyMessages: "remove" }));
}

// 11 Oct Clef trial: tellCareTeam was called for 7 of 14 emergencies, none about someone with her (a husband's chest pain,
// a floppy baby), which got 999 in words alone; so it is asked for first, for anyone with her. A reading was said to be
// saved with no tool called: a claim waits for the tool's success.
const SYSTEM = `You are Sona Care, a hospital's assistant for its patients, chatting with one patient in the Sona Care app. Answer whatever they ask, fully: their own care, any other health or medicine question, or anything else. The conversation so far is above: use it for follow-up questions.
Tools:
- readMyRecord: what the hospital has recorded about this patient (discharge plan, medicines, visits, history, allergies, results, the doctor's note, check-in replies, doses taken). Call it before answering anything about them, even if you read it earlier in this chat: it may have changed.
- searchLeaflets: the hospital's own patient leaflets. Call it for general health advice (recovery, food, activity, warning signs, how a medicine works). When you use a leaflet, put its number in brackets after the sentence, like [1].
- findDoctors: the hospital's doctors and their free clinic times, when they want a doctor, a specialist or a named doctor.
- requestBooking: asks the care team for one of a doctor's free times. Only once the patient has chosen the doctor and the time and said yes.
- tellCareTeam: when they say they, or someone with them, have an emergency sign right now (chest pain, severe breathlessness, confusion, fainting, a seizure, coughing blood, heavy bleeding, a baby or child very drowsy or floppy). Asking which signs to watch for is a question, not an emergency.
How to answer:
- Plain, kind words at a reading age of about 12. Short paragraphs; a short list is fine.
- Facts about them (a medicine, a dose, a date, a result, a diagnosis) come from their record. If their record does not hold it, say so plainly.
- When your answer is general advice and not from their record, say so in a few words. A leaflet is general advice for any patient, never a fact about them.
- If they say they, or someone with them, have an emergency sign now, in any language: call tellCareTeam first, every time, then tell them to call 999 or go to the nearest emergency department.
- Say you did something (saved, booked, sent, told anyone) only after its tool returned success.`;

/** The instructions for a turn, with the language of the patient's latest message. */
export const systemFor = (language: Language) =>
  `${SYSTEM}\nTheir latest message is in ${LANGUAGE_NAME[language]}: answer in ${LANGUAGE_NAME[language]}, translating anything you take from their record or a leaflet.`;

/** How long one model step may take (the box's own limit on a streamed answer). */
const STEP_MS = 60_000;

/** Sona Med through the boxes' adapter (Baseten, or SageMaker in Malaysia when SAGEMAKER_ENDPOINTS names the brain). */
export function sonaMed(baseten: Baseten) {
  const { send, up, wake } = boxes(baseten);
  return {
    // Only the path of the provider's URL is used: `send` addresses the brain box (and SageMaker's fetcher moves it).
    model: createOpenAICompatible({
      name: "sona-med", baseURL: "https://brain/v1",
      fetch: (url, init) => send("brain", new URL(String(url)).pathname, init?.body ?? "", "application/json", STEP_MS, init?.signal ?? undefined),
    }).chatModel(BRAIN_MODEL) as LanguageModel,
    /** Minutes until a cold brain box is ready (it is woken now, not waited for); none when it is up. */
    async waking() {
      if (await up("brain")) return undefined;
      starting("brain");
      void wake("brain");
      return wakingOf("brain").waking;
    },
  };
}
export type SonaMed = ReturnType<typeof sonaMed>;

export type ChatTurn = {
  /** The patient's own context: every tool reads and writes for her alone. */
  context: Context & { hospitalId: string; patientId: string };
  /** The whole conversation, her new question last (the agent keeps it). */
  messages: UIMessage[];
  /** None: no hosted model, and Sona says she cannot answer now. */
  med?: SonaMed;
  library?: Library;
  signal?: AbortSignal;
};

/** What a turn found out while it ran, for the answer's metadata (ChatMeta). */
type Found = { record: boolean; urgent: boolean; passages: Passage[]; doctors: Doctor[]; told?: Promise<Awaited<ReturnType<typeof tellCareTeam>>> };

/** The tools, each over the app's own server code, scoped to her by `context`. */
function toolsFor(turn: ChatTurn, found: Found, language: Language, tell: () => Found["told"]) {
  const { context } = turn, { hospitalId, patientId } = context;
  return {
    readMyRecord: tool({
      description: "What the hospital has recorded about this patient: discharge plan, medicines, visits, history, allergies, results, the doctor's note, check-in replies and doses taken.",
      inputSchema: z.object({}),
      execute: async () => { found.record = true; return (await recordText(context)).text; },
    }),
    searchLeaflets: tool({
      description: "Search the hospital's patient leaflets (general advice for any patient). Returns numbered passages; cite a passage you use by its number, like [1].",
      inputSchema: z.object({ query: z.string().min(2).max(500).describe("what to look for, in a few words") }),
      execute: async ({ query }) => {
        // Numbered on from this turn's earlier searches, so a number names one leaflet.
        const passages = passagesIn(await leafletHits(turn.library, hospitalId, query), language).map((p, i) => ({ ...p, n: found.passages.length + i + 1 }));
        found.passages.push(...passages);
        return passages.length ? passages.map(p => `[${p.n}] ${p.title}: ${p.text}`).join("\n") : "No leaflet found: answer from general knowledge and say it is general advice.";
      },
    }),
    findDoctors: tool({
      description: "The hospital's doctors with their free clinic times: by specialty, condition or name; with no search, the patient's care team.",
      inputSchema: z.object({ search: z.string().max(200).optional().describe("a specialty, a condition or a doctor's name") }),
      execute: async ({ search }) => {
        const named = search ? await doctorsFor(context, search) : [];
        const shown = (named.length ? named : (await doctorsFor(context)).filter(d => d.careTeam)).slice(0, 3);
        found.doctors = shown.map(({ nextSlots: _, hospitalId: _h, ...doctor }) => doctor);
        return shown.map(d => ({
          id: d.id, name: d.name, specialty: d.specialty, room: d.room, careTeam: d.careTeam, rating: d.rating, languages: d.languages,
          freeTimes: d.nextSlots.flatMap(s => s.times).slice(0, 6).map(t => ({ startsAt: t.toISOString(), when: `${slotWords(t).day} ${slotWords(t).time}` })),
        }));
      },
    }),
    requestBooking: tool({
      description: "Ask the care team for one of a doctor's free times (they confirm it). Only after the patient chose the doctor and the time and said yes.",
      inputSchema: z.object({
        doctorId: z.string().min(1), startsAt: z.string().describe("one of the doctor's freeTimes startsAt, exactly as findDoctors gave it"),
        reason: z.string().max(200).optional(),
      }),
      execute: async ({ doctorId, startsAt, reason }) => {
        try {
          const asked = await requestBooking(context, { doctorId, startsAt: new Date(startsAt), reason });
          // What the app's booking announces (patientProcedure): the care team's My Day and her Schedule re-read.
          await context.announce?.(hospitalId, { topic: "bookings", patientId }).catch(() => {});
          return { requested: true, doctor: asked.doctorName, when: `${slotWords(asked.startsAt).day} ${slotWords(asked.startsAt).time}`, status: asked.status };
        } catch (error) {
          return { requested: false, why: error instanceof Error ? error.message : "It could not be requested." };
        }
      },
    }),
    tellCareTeam: tool({
      description: "Flag the patient's own words to their care team. Call it every time they say they, or someone with them, have an emergency sign right now, in any language, before telling them to call 999. Not for questions about which signs to watch for.",
      inputSchema: z.object({}),
      execute: async () => { found.urgent = true; return { told: Boolean(await tell()) }; },
    }),
  };
}

/** How long the end of an answer waits for the care team's task before finishing without it (as the call does). */
const TOLD_WAIT_MS = 8000;
const within = <T>(promise: Promise<T>, ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([promise, new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), ms); })]).finally(() => clearTimeout(timer));
};

/** Sona's own line as a whole answer (no model, or it is starting). */
function say(writer: UIMessageStreamWriter, text: string) {
  const id = crypto.randomUUID();
  writer.write({ type: "text-start", id });
  writer.write({ type: "text-delta", id, delta: text });
  writer.write({ type: "text-end", id });
}

/**
 * The turn as the AI SDK's UI message stream (what AIChatAgent's onChatMessage returns): Sona Med's words and tool calls as
 * they come, then one `finish` carrying ChatMeta. A question naming an emergency sign reaches the care team whatever the
 * model does (care.ask's keyword floor, callNow), as does one Clef reads as an emergency (../decide, beside the model,
 * never waited for before it: an urgent task, whatever the care team's reader says, though the answer's `urgent` stays the
 * model's); the model's own tellCareTeam call shares the same task.
 */
export function chatTurn(turn: ChatTurn): Response {
  const question = textOf(turn.messages.findLast(m => m.role === "user") ?? { role: "user", parts: [] });
  const language = languageOf(question), lines = LINES[language];
  const { context } = turn, found: Found = { record: false, urgent: false, passages: [], doctors: [] };
  const tell = (raised = false) => found.told ??= tellCareTeam(context, context.hospitalId, context.patientId, question, raised ? CLEF_MODEL : undefined)
    .catch(error => { console.error("care team not told", error); return undefined; });
  // The floor's task waits for Clef's read (at once while it is off), so one task carries both.
  // Clef's read is not the model's urgent flag: a near miss would drop the model's words for the 999 card on the phone.
  const clef = emergencyOf(context.clef, question).then(yes => { if (yes || callNow(question)) void tell(yes); });

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      let text = "", started = false;
      const waking = turn.med && await turn.med.waking();
      // An error mid-way keeps what was already said; with nothing said, Sona's line says she cannot answer (below).
      const failed = (error: unknown) => { console.error("chat turn failed", error); return ""; };
      if (turn.med && !waking) {
        try {
          const result = streamText({
            model: turn.med.model, system: systemFor(language), messages: await historyFor(turn.messages), tools: toolsFor(turn, found, language, tell),
            stopWhen: stepCountIs(5), maxRetries: 0, temperature: 0.2, maxOutputTokens: 1200, abortSignal: turn.signal,
          });
          for await (const chunk of result.toUIMessageStream({ sendFinish: false, sendReasoning: false, onError: failed })) {
            if (chunk.type === "error") continue;
            if (chunk.type === "start") started = true;
            if (chunk.type === "text-delta") text += chunk.delta;
            writer.write(chunk);
          }
        } catch (error) { failed(error); }
      }
      if (!started) writer.write({ type: "start" });
      if (turn.signal?.aborted) return;
      const answered = Boolean(text.trim());
      if (!answered) say(writer, waking ? lines.starting(waking) : lines.unavailable);
      await clef; // long since in (DECIDE_MS at most), unless the model failed at once
      const told = found.told && await within(found.told, TOLD_WAIT_MS);
      const meta: ChatMeta = {
        source: answered ? "model" : "fixture", ...answered ? { model: BRAIN_MODEL } : waking ? { waking } : {},
        // A task its reader read as urgent makes the answer urgent; one only Clef raised (read by Clef) does not.
        grounded: answered && found.record, urgent: found.urgent || (told?.label === "urgent" && !("model" in told.readBy && told.readBy.model === CLEF_MODEL)),
        // Only a leaflet that was offered this turn can be a source: a number the model made up names nothing.
        sources: citedSources([...text.matchAll(/\[(\d+)\]/g)].map(m => Number(m[1])), found.passages),
        ...told && { careTeam: { taskId: told.taskId, title: told.title, line: lines.told } },
        ...found.doctors.length ? { doctors: found.doctors } : {},
      };
      writer.write({ type: "finish", messageMetadata: meta });
    },
  });
  return createUIMessageStreamResponse({ stream });
}
