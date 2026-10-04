import { EMERGENCY, basetenModels } from "@sona-ai/api/baseten-models";
import { clockOffsetOf, shifted } from "@sona-ai/api/clock";
import type { Context as ApiContext } from "@sona-ai/api/context";
import { stubModels } from "@sona-ai/api/models";
import { lastDischarge, patientPlan, planText } from "@sona-ai/api/routers/care-plan";
import { LINES, answerTurn, basetenChat, callNow, type TurnSummary } from "@sona-ai/api/voice-agent/answer";
import { tellCareTeam } from "@sona-ai/api/voice-agent/care-team";
import { SonaTranscriber, type SessionHooks } from "@sona-ai/api/voice-agent/listen";
import { CallHistory, Checks, LiveTurns, Router, Says, liveBrief, liveStart, mayReport, type Brain, type Ear, type Heard, type Unit } from "@sona-ai/api/voice-agent/live";
import { awsOf, hosted, sagemakerLive, type HostingEnv, type LiveLink } from "@sona-ai/api/sagemaker";
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
/** Box ②'s words for a turn are the ones shown; box ④'s own are shown in their place when box ②'s have not come by then. */
const OWN_WORDS_WAIT_MS = 5000;

/** One call's link to box ④: the phone's audio until the box takes it, the socket after, and Sona's answers so far. */
class LiveCall {
  box?: LiveLink;
  pending: ArrayBuffer[] = [];
  bytes = 0;
  turns = new LiveTurns();
  /** The patient cut Sona off: the rest of that answer's audio is not sent (the phone has stopped it already). */
  muted = false;
  closed = false;
  language: Language = "en";
  checks = new Checks();
  /** When box ②'s ear last gave the patient's words. */
  heardAt = -Infinity;
  /** With Gemma as the brain: her answers on their way to the box, the call so far, and the answer being written. */
  says?: Says;
  history = new CallHistory();
  answering?: AbortController;
  /** How Gemma's answer went (answerTurn's `done`), sent when she has said it. */
  summary?: TurnSummary;
  /** The say written before the box took the call: it goes once it has (a say replaces the one before, so only the last). */
  script?: string;
  /** With the router: her own words kept back until the patient's are known, and whose the last second was (its voice follows). */
  router?: Router;
  scripted = new Map<number, boolean>();
  voiceOf?: number;
  last = false;

  say(message: string) {
    if (this.box) this.box.send(message);
    else this.script = message;
  }

  hear(chunk: ArrayBuffer) {
    if (this.closed) return;
    if (this.box) return this.box.send(chunk);
    this.pending.push(chunk);
    for (this.bytes += chunk.byteLength; this.bytes > PENDING_BYTES && this.pending.length > 1;) this.bytes -= this.pending.shift()!.byteLength;
  }

  close() {
    this.closed = true;
    this.answering?.abort();
    this.box?.close();
  }
}

/**
 * Sona Care's live voice on MiniCPM-o (box ④, packages/infra/baseten/live): the same phone protocol and route as
 * SonaVoiceAgent (voice.ts), chosen by SONA_LIVE_URL. One model hears the patient a second at a time and answers in Sona's
 * voice as it hears, so there is no turn of ours between: the agent only relays (packages/api/src/voice-agent/live.ts).
 * Every chunk from the phone goes to box ④ and to Sona's ears (box ②'s Manglish ASR), which keep what the patient said,
 * for the phone and the record, and run the two checks that stay (user, 1 Oct): the 999 line when an emergency sign was
 * heard and Sona did not send them to 999 herself, and the care team told when the patient reports feeling worse.
 * Box ④ writes each turn down too (3 Oct): the checks run on either ear's words, once a turn, so they hold while box ②
 * sleeps or mishears (docs/minicpm-o-finetune.md, "One ear").
 * With SONA_LIVE_BRAIN=gemma the brain is not box ④'s (it said "fifty milligram" for 500 mg): she is held to listening,
 * each turn box ② writes down is answered by Gemma exactly as on the three-model call (answerTurn), and box ④ says those
 * words in Sona's voice (Says). Box ② is then the only ear.
 */
export class SonaLiveAgent extends withVoiceInput(Agent<Env>) {
  readonly #baseten = hosted(this.env);
  readonly #models = this.#baseten ? basetenModels(this.#baseten) : stubModels;
  readonly #chat = this.#baseten && basetenChat(this.#baseten);
  readonly #brain: Brain = this.env.SONA_LIVE_BRAIN === "gemma" || this.env.SONA_LIVE_BRAIN === "router" ? this.env.SONA_LIVE_BRAIN : "own";
  readonly #gemma = this.#brain === "gemma";
  /** Box ④ writes the patient down for Gemma itself, and box ② is left out of the call. */
  readonly #oneEar = this.#gemma && this.env.SONA_LIVE_EAR === "own";
  readonly #calls = new Map<string, LiveCall>();

  // The app speaks the voice protocol only: no state-sync or identity frames (which would name the instance).
  shouldSendProtocolMessages() {
    return false;
  }

  /** The call starts here (before onCallStart): each chunk from the phone goes to box ④ and to Sona's ears. */
  createTranscriber(connection: Connection) {
    this.#calls.get(connection.id)?.close();
    const call = new LiveCall();
    if (this.#brain !== "own") call.says = new Says(say => call.say(JSON.stringify(say)));
    if (this.#brain === "router") call.router = new Router();
    this.#calls.set(connection.id, call);
    if (this.#oneEar) return { createSession: () => ({ feed: (chunk: ArrayBuffer) => call.hear(chunk), close: () => {} }) };
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
    const box = await openBox(this.env.SONA_LIVE_URL, this.env, this.#baseten?.apiKey).catch(() => undefined);
    if (call.closed) return box?.close();
    if (!box) return this.#tell(connection, LINES[call.language].unavailable);
    box.onmessage = data => this.#fromBox(connection, call, data);
    box.onclose = () => { if (!call.closed) this.#tell(connection, LINES[call.language].unavailable); call.close(); };
    // Her trained voice in every language (the box's "v1" slot holds talker voice-v3, trained on the live layout:
    // docs/minicpm-o-finetune.md); voice-v1 garbled live English, so English and Chinese used the model's own until 3 Oct.
    // On SageMaker's L4s her own writing-down (2.6 s) stalls her voice, so box ② alone writes the patient down there.
    box.send(JSON.stringify(liveStart(liveBrief(home && planText(home), call.language), this.#brain, !onSageMaker(this.env.SONA_LIVE_URL), this.#oneEar ? "own" : "box2")));
    send(connection, { type: "audio_config", format: "pcm16", sampleRate: 24_000 });
    call.box = box;
    for (const chunk of call.pending.splice(0)) box.send(chunk);
    if (call.script) box.send(call.script);
  }

  #fromBox(connection: Connection, call: LiveCall, data: string | ArrayBuffer) {
    if (typeof data !== "string") {
      // The second of her voice the last unit described (on two GPUs, the unit a "voice" event named just before).
      const scripted = call.voiceOf === undefined ? call.last : call.scripted.get(call.voiceOf) ?? call.last;
      call.voiceOf = undefined;
      const audio = call.router && !scripted ? call.router.own(data) : data;
      if (audio && !call.muted) sendAudio(connection, audio);
      return;
    }
    const unit = JSON.parse(data) as Unit | Heard | { type: "ready" } | { type: "voice"; i: number };
    if (unit.type === "heard") return this.#heard(connection, call, unit.text);
    if (unit.type === "voice") { call.voiceOf = unit.i; return; }
    if (unit.type !== "unit") return;
    if (!call.router) return this.#show(connection, call, call.says ? call.says.unit(unit) : unit);
    // The router: a second given to her to say is Gemma's answer (Says); one of her own goes by whether the turn is hers.
    if (!unit.listen) {
      call.last = Boolean(unit.scripted);
      call.scripted.set(unit.i, call.last);
      if (call.scripted.size > 64) call.scripted.delete(call.scripted.keys().next().value!);
    }
    if (unit.listen) { call.router.listened(); return this.#show(connection, call, unit); }
    if (!unit.scripted) return this.#show(connection, call, call.router.own(unit, unit.end_of_turn), true);
    const said = call.says!.unit(unit);
    if (said?.end_of_turn) call.router.done();
    this.#show(connection, call, said);
  }

  /** One second of Sona's side of the call, on the phone; `own`: an answer of her own on a call where Gemma answers too. */
  #show(connection: Connection, call: LiveCall, unit?: Pick<Unit, "listen" | "text" | "end_of_turn">, own = false) {
    if (!unit) return;
    for (const event of call.turns.unit(unit)) {
      if (event.type === "transcript_start") call.muted = false;
      send(connection, event);
      if (event.type !== "transcript_end") continue;
      // As SonaVoiceAgent ends a turn (a client may ignore it; apps/server/test/voice-call.ts waits for it). Gemma's
      // answer ends as answerTurn summed it up; one cut off has no summary, as there.
      const turn = call.says && !own ? call.summary : { grounded: true, urgent: EMERGENCY.test(event.text), source: "model", model: "sona-live" };
      if (turn) send(connection, { type: "sona_turn", ...turn });
    }
  }

  /**
   * What the patient said, as box ② heard it: shown on the phone and checked. Box ④ is already answering it, so this
   * starts no turn of the SDK's (null tells it so); with Gemma as the brain, her answer starts here.
   */
  async afterTranscribe(transcript: string, connection: Connection) {
    send(connection, { type: "transcript_interim", text: "" });
    send(connection, { type: "transcript", role: "user", text: transcript });
    const call = this.#calls.get(connection.id);
    if (call) {
      call.heardAt = Date.now();
      const reported = this.#check(connection, call, "box2", transcript);
      if (call.router) return this.#route(connection, call, transcript, reported), null;
      if (call.says) void this.#answer(connection, call, call.says, transcript, reported);
    }
    return null;
  }

  /**
   * Gemma answers the turn as SonaVoiceAgent's onTurn does (answerTurn: the plan, the call so far, the 999 line first,
   * the care team told), and each sentence goes to box ④ to say as soon as it is written. A turn that comes while
   * the last answer is still being written or said takes its place. The care team is told once a turn: by the check on
   * the patient's words when that fired (`reported`), else when Gemma flags the turn.
   */
  async #answer(connection: Connection, call: LiveCall, says: Says, question: string, reported?: Promise<boolean>) {
    call.answering?.abort();
    const { signal } = call.answering = new AbortController(), { history, said } = call.history.turn(question);
    call.summary = undefined;
    this.#show(connection, call, says.begin());
    try {
      const { hospitalId, patientId } = patientOf(this.name);
      // ponytail: the plan is read again each turn, as onTurn reads it (two queries before Gemma is asked); the one
      // onCallStart read could be kept for the call if those milliseconds matter.
      const plan = await patientPlan({ ...await this.#context(hospitalId), hospitalId, patientId });
      const parts = answerTurn({
        question, history, signal, chat: this.#chat,
        plan: plan.status === "discharged" ? planText(plan) : undefined,
        language: call.language,
        escalate: () => reported ?? this.#careTeam(connection, question),
        done: summary => { call.summary = summary; },
      });
      for await (const part of parts) {
        if (signal.aborted) return;
        if (part.type !== "text-delta") continue;
        said(part.text);
        says.sentence(part.text);
      }
    } catch {
      if (!signal.aborted) this.#tell(connection, LINES[call.language].unavailable);
    }
    if (!signal.aborted) this.#show(connection, call, says.end());
  }

  /**
   * The router's turn: only talk, and what she has begun to say by herself goes to the phone (the rest follows as she
   * says it); anything else, and Gemma answers it as on the hybrid call, her own start left out.
   */
  #route(connection: Connection, call: LiveCall, transcript: string, reported?: Promise<boolean>) {
    const { by, kept } = call.router!.heard(transcript);
    if (by === "gemma") return void this.#answer(connection, call, call.says!, transcript, reported);
    call.answering?.abort(); // an answer of Gemma's still being said gives way to the new turn, as on the hybrid call
    this.#show(connection, call, call.says!.stop());
    for (const item of kept) {
      if (item instanceof ArrayBuffer) { if (!call.muted) sendAudio(connection, item); }
      else this.#show(connection, call, item as Unit, true);
    }
  }

  /** The same turn as box ④ wrote it down: checked too, and shown when box ②'s words do not come (quiet comes as "."). */
  #heard(connection: Connection, call: LiveCall, transcript: string) {
    if (!/[\p{L}\p{N}]/u.test(transcript)) return;
    if (this.#oneEar && call.says) { // her ear is the call's only one: its words are shown, checked and answered
      send(connection, { type: "transcript", role: "user", text: transcript });
      return void this.#answer(connection, call, call.says, transcript, this.#check(connection, call, "box4", transcript));
    }
    this.#check(connection, call, "box4", transcript);
    const at = Date.now();
    setTimeout(() => {
      if (!call.closed && call.heardAt < at - OWN_WORDS_WAIT_MS) send(connection, { type: "transcript", role: "user", text: transcript });
    }, OWN_WORDS_WAIT_MS);
  }

  /** The two checks on what the patient said, by either ear, each once a turn. A report on its way to the care team comes back. */
  #check(connection: Connection, call: LiveCall, ear: Ear, transcript: string) {
    if (callNow(transcript) && call.checks.take("call999", ear, transcript, Date.now())) {
      const from = call.turns.said.length;
      setTimeout(() => {
        if (!call.closed && !call.turns.sent999(from)) this.#tell(connection, LINES[call.language].call999);
      }, CALL_999_WAIT_MS);
    }
    // The care team's own reader (Gemma, as for a check-in reply) decides whether to flag a task.
    return mayReport(transcript) && call.checks.take("report", ear, transcript, Date.now()) ? this.#careTeam(connection, transcript) : undefined;
  }

  /**
   * The patient spoke over Sona: the phone stopped her, so the rest of that answer's audio stays here. An answer of
   * Gemma's stops being written and said too; what the patient says next is answered as a new turn.
   */
  onInterrupt(connection: Connection) {
    const call = this.#calls.get(connection.id);
    if (!call) return;
    call.muted = true;
    call.answering?.abort();
    this.#show(connection, call, call.says?.stop());
    call.router?.done();
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
    return Boolean(told);
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

/** SONA_LIVE_URL "sagemaker:<endpoint>": box ④ on a SageMaker endpoint in Malaysia (packages/infra/aws/live). */
const onSageMaker = (url: string) => url.startsWith("sagemaker:");

/**
 * The call's link to box ④. On Baseten its WebSocket, signed with the Baseten key (a Worker opens it as a fetch
 * upgrade), a cold box woken meanwhile; on SageMaker the same call as requests (sagemakerLive).
 */
async function openBox(url: string, env: HostingEnv, apiKey?: string): Promise<LiveLink> {
  if (onSageMaker(url)) {
    const aws = awsOf(env);
    if (!aws) throw new Error("box ④ on SageMaker needs the AWS keys");
    return sagemakerLive(aws, url.slice("sagemaker:".length));
  }
  const http = url.replace(/^ws/, "http"), headers = apiKey ? { Authorization: `Api-Key ${apiKey}` } : undefined;
  const wake = /^(https:\/\/model-[^/]+\/environments\/[^/]+)\/websocket$/.exec(http)?.[1];
  if (wake && headers) void fetch(`${wake}/wake`, { method: "POST", headers, signal: AbortSignal.timeout(5000) }).catch(() => {});
  // The time limit covers opening only: left on the request, it closed the open call at OPEN_MS (3 Oct, 20 s into a call).
  const opening = new AbortController(), limit = setTimeout(() => opening.abort(), OPEN_MS);
  const res = await fetch(http, { headers: { Upgrade: "websocket", ...headers }, signal: opening.signal }).finally(() => clearTimeout(limit));
  const socket = res.webSocket;
  if (!socket) throw new Error(`box ④ answered ${res.status}`);
  socket.binaryType = "arraybuffer"; // a Blob by default from this compatibility date, which reached the phone as text
  socket.accept();
  const link: LiveLink = { send: data => socket.send(data), close: () => { try { socket.close(1000, "call ended"); } catch { /* already closed */ } } };
  socket.addEventListener("message", event => link.onmessage?.(event.data as string | ArrayBuffer));
  socket.addEventListener("close", () => link.onclose?.());
  return link;
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
