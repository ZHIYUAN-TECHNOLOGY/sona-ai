import { EMERGENCY, basetenModels } from "@sona-ai/api/baseten-models";
import { clockOffsetOf, shifted } from "@sona-ai/api/clock";
import type { Context as ApiContext } from "@sona-ai/api/context";
import { stubModels } from "@sona-ai/api/models";
import { lastDischarge, patientPlan, planText } from "@sona-ai/api/routers/care-plan";
import { LINES, callNow } from "@sona-ai/api/voice-agent/answer";
import { tellCareTeam } from "@sona-ai/api/voice-agent/care-team";
import { SonaTranscriber, type SessionHooks } from "@sona-ai/api/voice-agent/listen";
import { LiveTurns, liveBrief, mayReport, type Unit } from "@sona-ai/api/voice-agent/live";
import { Agent, type Connection } from "agents";
import { withVoiceInput } from "agents/voice";

import { announcer, followUpAgents } from "../context";
import { getDb } from "../services";
import { patientOf } from "./voice";

type Language = keyof typeof LINES;

/** After the patient names an emergency sign, Sona has this long to send them to 999 herself before her 999 line is said for her. */
const CALL_999_WAIT_MS = 6000;
/** Audio the phone sends before box ④ takes the call waits for it, up to 30 s (16 kHz PCM16). */
const PENDING_BYTES = 30 * 32_000;
/** How long box ④ gets to take a call; a cold one starts meanwhile. ponytail: measure its cold start and say it, as startingBoxes does. */
const OPEN_MS = 20_000;

/** One call's link to box ④: the phone's audio until the box takes it, the socket after, and Sona's answers so far. */
class LiveCall {
  box?: WebSocket;
  pending: ArrayBuffer[] = [];
  bytes = 0;
  turns = new LiveTurns();
  /** The patient cut Sona off: the rest of that answer's audio is not sent (the phone has stopped it already). */
  muted = false;
  closed = false;
  language: Language = "en";

  hear(chunk: ArrayBuffer) {
    if (this.closed) return;
    if (this.box) return this.box.send(chunk);
    this.pending.push(chunk);
    for (this.bytes += chunk.byteLength; this.bytes > PENDING_BYTES && this.pending.length > 1;) this.bytes -= this.pending.shift()!.byteLength;
  }

  close() {
    this.closed = true;
    try { this.box?.close(1000, "call ended"); } catch { /* already closed */ }
  }
}

/**
 * Sona Care's live voice on MiniCPM-o (box ④, packages/infra/baseten/live): the same phone protocol and route as
 * SonaVoiceAgent (voice.ts), chosen by SONA_LIVE_URL. One model hears the patient a second at a time and answers in Sona's
 * voice as it hears, so there is no turn of ours between: the agent only relays (packages/api/src/voice-agent/live.ts).
 * Every chunk from the phone goes to box ④ and to Sona's ears (box ②'s Manglish ASR), which keep what the patient said,
 * for the phone and the record, and run the two checks that stay (user, 1 Oct): the 999 line when an emergency sign was
 * heard and Sona did not send them to 999 herself, and the care team told when the patient reports feeling worse.
 */
export class SonaLiveAgent extends withVoiceInput(Agent<Env>) {
  readonly #baseten = this.env.BASETEN_API_KEY ? { apiKey: this.env.BASETEN_API_KEY } : undefined;
  readonly #models = this.#baseten ? basetenModels(this.#baseten) : stubModels;
  readonly #calls = new Map<string, LiveCall>();

  // The app speaks the voice protocol only: no state-sync or identity frames (which would name the instance).
  shouldSendProtocolMessages() {
    return false;
  }

  /** The call starts here (before onCallStart): each chunk from the phone goes to box ④ and to Sona's ears. */
  createTranscriber(connection: Connection) {
    this.#calls.get(connection.id)?.close();
    const call = new LiveCall();
    this.#calls.set(connection.id, call);
    const ears = new SonaTranscriber(audio => this.#models.transcribe({ audio }));
    return {
      createSession: (hooks?: SessionHooks) => {
        const heard = ears.createSession(hooks);
        return { feed: (chunk: ArrayBuffer) => { call.hear(chunk); heard.feed(chunk); }, close: heard.close };
      },
    };
  }

  /** Box ④ takes the call with the patient's plan in its brief; Sona's voice comes back as 24 kHz PCM, a second a frame. */
  async onCallStart(connection: Connection) {
    const call = this.#calls.get(connection.id);
    if (!call) return;
    const { hospitalId, patientId } = patientOf(this.name);
    const plan = await patientPlan({ ...await this.#context(hospitalId), hospitalId, patientId }).catch(() => undefined);
    const home = plan?.status === "discharged" ? plan : undefined;
    const discharged = home?.language ?? await lastDischarge(getDb(), hospitalId, patientId).then(d => d?.language, () => undefined);
    call.language = languageOf(connection, discharged);
    const box = await openBox(this.env.SONA_LIVE_URL, this.#baseten?.apiKey).catch(() => undefined);
    if (call.closed) return box?.close();
    if (!box) return this.#tell(connection, LINES[call.language].unavailable);
    box.addEventListener("message", event => this.#fromBox(connection, call, event.data));
    box.addEventListener("close", () => { if (!call.closed) this.#tell(connection, LINES[call.language].unavailable); call.close(); });
    // Her voice by language until voice v2 (docs/minicpm-o-finetune.md, run log): talker v1 speaks Malay far better than
    // the model's own (14.6% against 36.4% of words wrong), but garbles more in live English (13.3% against 7.8%).
    const voice = call.language === "ms" ? "v1" : "base";
    box.send(JSON.stringify({ type: "start", system: liveBrief(home && planText(home), call.language), voice }));
    send(connection, { type: "audio_config", format: "pcm16", sampleRate: 24_000 });
    call.box = box;
    for (const chunk of call.pending.splice(0)) box.send(chunk);
  }

  #fromBox(connection: Connection, call: LiveCall, data: string | ArrayBuffer) {
    if (typeof data !== "string") {
      if (!call.muted) sendAudio(connection, data); // the second of her voice the last unit described
      return;
    }
    const unit = JSON.parse(data) as Unit | { type: "ready" };
    if (unit.type !== "unit") return;
    for (const event of call.turns.unit(unit)) {
      if (event.type === "transcript_start") call.muted = false;
      send(connection, event);
      // As SonaVoiceAgent ends a turn (a client may ignore it; apps/server/test/voice-call.ts waits for it).
      if (event.type === "transcript_end") send(connection, { type: "sona_turn", grounded: true, urgent: EMERGENCY.test(event.text), source: "model", model: "sona-live" });
    }
  }

  /**
   * What the patient said, as box ② heard it: shown on the phone and checked. Box ④ is already answering it, so this
   * starts no turn of ours (null tells the SDK so).
   */
  async afterTranscribe(transcript: string, connection: Connection) {
    send(connection, { type: "transcript_interim", text: "" });
    send(connection, { type: "transcript", role: "user", text: transcript });
    const call = this.#calls.get(connection.id);
    if (call && callNow(transcript)) {
      const from = call.turns.said.length;
      setTimeout(() => {
        if (!call.closed && !call.turns.sent999(from)) this.#tell(connection, LINES[call.language].call999);
      }, CALL_999_WAIT_MS);
    }
    // The care team's own reader (Gemma, as for a check-in reply) decides whether to flag a task.
    if (mayReport(transcript)) void this.#careTeam(connection, transcript);
    return null;
  }

  /** The patient spoke over Sona: the phone stopped her, so the rest of that answer's audio stays here. */
  onInterrupt(connection: Connection) {
    const call = this.#calls.get(connection.id);
    if (call) call.muted = true;
  }

  onCallEnd(connection: Connection) {
    this.#calls.get(connection.id)?.close();
    this.#calls.delete(connection.id);
  }

  onClose(connection: Connection) {
    this.onCallEnd(connection);
  }

  async #careTeam(connection: Connection, transcript: string) {
    const { hospitalId, patientId } = patientOf(this.name);
    const told = await tellCareTeam(await this.#context(hospitalId), hospitalId, patientId, transcript).catch(() => undefined);
    if (told) send(connection, { type: "sona_care_team", ...told });
  }

  /** As a route's context: the hospital's demo clock, live updates, and the visit's check-in agent. */
  async #context(hospitalId: string): Promise<ApiContext> {
    const db = getDb();
    return { db, session: null, models: this.#models, now: shifted(undefined, await clockOffsetOf(db, hospitalId)), announce: announcer(this.env), followUps: followUpAgents(this.env) };
  }

  /** A line in words, read by the phone's own voice (as SonaVoiceAgent tells one): Sona's line, then listening. */
  #tell(connection: Connection, text: string) {
    send(connection, { type: "transcript", role: "assistant", text });
    send(connection, { type: "sona_say", text, reason: "notice" });
    send(connection, { type: "status", status: "listening" });
  }
}

/** Box ④'s socket, signed with the Baseten key (a Worker opens it as a fetch upgrade); a cold box is woken meanwhile. */
async function openBox(url: string, apiKey?: string): Promise<WebSocket> {
  const http = url.replace(/^ws/, "http"), headers = apiKey ? { Authorization: `Api-Key ${apiKey}` } : undefined;
  const wake = /^(https:\/\/model-[^/]+\/environments\/[^/]+)\/websocket$/.exec(http)?.[1];
  if (wake && headers) void fetch(`${wake}/wake`, { method: "POST", headers, signal: AbortSignal.timeout(5000) }).catch(() => {});
  const res = await fetch(http, { headers: { Upgrade: "websocket", ...headers }, signal: AbortSignal.timeout(OPEN_MS) });
  if (!res.webSocket) throw new Error(`box ④ answered ${res.status}`);
  res.webSocket.accept();
  return res.webSocket;
}

/** The app's language (`?lang=` on the socket), else the one chosen at discharge, else English. */
function languageOf(connection: Connection, discharged?: Language): Language {
  const lang = connection.uri ? new URL(connection.uri).searchParams.get("lang") : null;
  return lang === "en" || lang === "ms" || lang === "zh" ? lang : discharged ?? "en";
}

function send(connection: Connection, message: Record<string, unknown>) {
  try { connection.send(JSON.stringify(message)); } catch { /* the phone hung up */ }
}
function sendAudio(connection: Connection, audio: ArrayBuffer) {
  try { connection.send(audio); } catch { /* the phone hung up */ }
}
