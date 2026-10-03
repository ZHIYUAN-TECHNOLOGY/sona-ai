import { basetenModels } from "@sona-ai/api/baseten-models";
import { clockOffsetOf, shifted } from "@sona-ai/api/clock";
import type { Context as ApiContext } from "@sona-ai/api/context";
import { stubModels } from "@sona-ai/api/models";
import { lastDischarge, patientPlan, planText } from "@sona-ai/api/routers/care-plan";
import { careLinkOf } from "@sona-ai/api/routers/hospital";
import { LINES, answerTurn, basetenChat } from "@sona-ai/api/voice-agent/answer";
import { tellCareTeam } from "@sona-ai/api/voice-agent/care-team";
import { SonaTranscriber } from "@sona-ai/api/voice-agent/listen";
import { SonaVoice, basetenSpeak, startingBoxes, warmBoxes, type PhoneVoice } from "@sona-ai/api/voice-agent/voice";
import { hosted } from "@sona-ai/api/sagemaker";
import { Agent, getAgentByName, type Connection } from "agents";
import { withVoice, type VoiceTurnContext } from "agents/voice";
import type { Context as HonoContext } from "hono";

import { announcer, followUpAgents } from "../context";
import { createAuth, getDb } from "../services";

type Language = keyof typeof LINES;

/**
 * Sona Care's live voice, on the Cloudflare Agents SDK (withVoice): one Durable Object per patient, named by the Worker
 * from the signed-in session (voiceRoute), never by the app. The patient talks naturally: our Manglish ASR hears each
 * turn (packages/api/src/voice-agent/listen.ts), Gemma answers anything they ask, their own care from their plan, sentence
 * by sentence (answer.ts), and Sona's Malaysian voice speaks it (voice.ts). The patient can cut in at any
 * point, which cancels the answer and the voice in flight. The SDK keeps the conversation, so follow-ups work.
 *
 * The protocol is the SDK's voice protocol (agents/voice VoiceClient: PCM16 16 kHz mono up; JSON events and one MP3 frame
 * per sentence down). An answer sent with no audio (Sona's voice is starting, slow or unavailable) is read by the phone's
 * own voice, and so is a notice (Sona's line, then "listening"). Three more JSON events, which a client may ignore:
 * - `sona_say` {text, reason: "starting" | "slow" | "unavailable" | "notice", waking?}: a sentence sent with no audio, and why.
 * - `sona_turn` {grounded, urgent, source, model?, waking?}: how the answer went, after its last sentence.
 * - `sona_care_team` {taskId, title}: what the patient reported reached their care team as a flagged task.
 */
export class SonaVoiceAgent extends withVoice(Agent<Env>) {
  readonly #baseten = hosted(this.env);
  readonly #models = this.#baseten ? basetenModels(this.#baseten) : stubModels;
  readonly #chat = this.#baseten && basetenChat(this.#baseten);
  /** Each answer turn's phone, so a sentence for the phone's voice reaches the phone that asked. */
  readonly #phoneOf = new WeakMap<AbortSignal, Connection>();
  /** The language chosen at discharge, read when a call starts: Sona's own lines when the app does not say (`?lang=`). */
  #discharged: Language | undefined;

  tts = new SonaVoice(this.#baseten ? basetenSpeak(this.#baseten) : async () => ({}), (said, turn) => {
    const phone = turn && this.#phoneOf.get(turn);
    if (phone) send(phone, { type: "sona_say", ...said });
  });

  // The app speaks the voice protocol only: no state-sync or identity frames (which would name the instance).
  shouldSendProtocolMessages() {
    return false;
  }

  /** The phone opened voice mode: the call's boxes are warmed while the patient gets ready (warmBoxes), not holding the socket. */
  onConnect() {
    if (this.#baseten) void warmBoxes(this.#baseten);
  }

  createTranscriber(connection: Connection) {
    return new SonaTranscriber(audio => this.#models.transcribe({ audio }), waking => {
      const lines = LINES[this.#language(connection)];
      if (!this.#baseten) this.#tell(connection, lines.off, { reason: "unavailable" });
      // The ears and Sona's voice share box ②: while it starts, the phone reads this too.
      else if (waking) this.#tell(connection, lines.hearingStarting(waking), { reason: "starting", waking });
      else this.#tell(connection, lines.missed, { reason: "notice" });
    });
  }

  /** On picking up, the call's boxes are woken, and the patient is told plainly if hearing or answers are still starting. */
  async onCallStart(connection: Connection) {
    const { hospitalId, patientId } = patientOf(this.name);
    try {
      this.#discharged = (await lastDischarge(getDb(), hospitalId, patientId))?.language ?? this.#discharged;
    } catch { /* Sona's lines stay in the app's language, or English */ }
    const lines = LINES[this.#language(connection)];
    if (!this.#baseten) return this.#tell(connection, lines.off, { reason: "unavailable" });
    const { voice, brain } = await startingBoxes(this.#baseten);
    if (voice) this.#tell(connection, lines.hearingStarting(voice), { reason: "starting", waking: voice });
    else if (brain) this.#tell(connection, lines.starting(brain), { reason: "starting", waking: brain });
  }

  async onTurn(transcript: string, { connection, messages, signal }: VoiceTurnContext) {
    this.#phoneOf.set(signal, connection);
    const { hospitalId, patientId } = patientOf(this.name);
    const db = getDb();
    // As a route's context: the hospital's demo clock, live updates, and the visit's check-in agent (a report wakes it, as a reply in the app does).
    const context: ApiContext = { db, session: null, models: this.#models, now: shifted(undefined, await clockOffsetOf(db, hospitalId)), announce: announcer(this.env), followUps: followUpAgents(this.env) };
    const plan = await patientPlan({ ...context, hospitalId, patientId });
    const home = plan.status === "discharged" ? plan : undefined;
    if (home) this.#discharged = home.language;
    return answerTurn({
      question: transcript, history: messages, signal, chat: this.#chat,
      plan: home && planText(home),
      language: this.#language(connection),
      escalate: async () => {
        const told = await tellCareTeam(context, hospitalId, patientId, transcript);
        if (told) send(connection, { type: "sona_care_team", ...told });
        return Boolean(told);
      },
      done: summary => send(connection, { type: "sona_turn", ...summary }),
    });
  }

  /** The app's language (`?lang=` on the socket), else the one chosen at discharge, else English. */
  #language(connection: Connection): Language {
    const lang = connection.uri ? new URL(connection.uri).searchParams.get("lang") : null;
    return lang === "en" || lang === "ms" || lang === "zh" ? lang : this.#discharged ?? "en";
  }

  /**
   * A notice in words, as an answer with no audio: Sona's line, then listening, so Sona Care reads it in the phone's voice
   * (Sona's own may be what is starting) and shows it.
   */
  #tell(connection: Connection, text: string, why: { reason: PhoneVoice["reason"] | "notice"; waking?: number }) {
    send(connection, { type: "transcript", role: "assistant", text });
    send(connection, { type: "sona_say", text, ...why });
    send(connection, { type: "status", status: "listening" });
  }
}

function send(connection: Connection, message: Record<string, unknown>) {
  try { connection.send(JSON.stringify(message)); } catch { /* the phone hung up */ }
}

// The agent's name is its patient, set only by voiceRoute from the session.
const nameOf = (link: { hospitalId: string; patientId: string }) => `${encodeURIComponent(link.hospitalId)}/${encodeURIComponent(link.patientId)}`;
export function patientOf(name: string) {
  const [hospitalId = "", patientId = ""] = name.split("/").map(decodeURIComponent);
  return { hospitalId, patientId };
}

/**
 * GET /agents/sona-voice-agent/:id (WebSocket), the SDK's own route shape, where `:id` is the signed-in account's user
 * id: it reaches that account's patient's agent and no other. The agent is named here from the account's care link, never
 * from the path, and a path naming another account is refused. It signs in as /live and the RPC client do: the session
 * cookie on the upgrade.
 */
export async function voiceRoute(c: HonoContext) {
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return c.text("Expected a WebSocket", 426);
  const db = getDb();
  const session = await (await createAuth(db)).api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) return c.text("Sign in first", 401);
  if (c.req.param("id") !== session.user.id) return c.text("This is another account's conversation", 403);
  const link = await careLinkOf(db, session.user.id);
  if (!link) return c.text("Join with the code on your discharge paper first", 403);
  // The call on MiniCPM-o (agents/live.ts) once its box is set; the app's route stays the same either way.
  const env = c.env as Env;
  const agent = env.SONA_LIVE_URL ? await getAgentByName(env.LIVE, nameOf(link)) : await getAgentByName(env.VOICE, nameOf(link));
  return agent.fetch(c.req.raw);
}
