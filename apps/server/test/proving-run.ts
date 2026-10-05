/**
 * The pre-demo check: proves that every answer Sona shows comes from a real model or outside service, not from the
 * pre-written fallback a cold or failing box leaves in its place. It signs in as the seeded synthetic accounts (TEST_DOCTOR,
 * TEST_MANAGER and the patient TEST_PATIENT, Amelia), calls each route that depends on a model through the typed client
 * the apps use (so a route whose input changes fails the type check here, not on the day), opens the live voice socket
 * with a typed question, and prints one line per check: pass/FAIL/skip, name, route, the model that answered, seconds,
 * and why it failed.
 *
 *   bun apps/server/test/proving-run.ts <server url> [options]
 *   bun apps/server/test/proving-run.ts http://localhost:3002 --only briefing,evidence,voice-agent
 *
 * Options:
 *   --only a,b        only these checks (names as printed; --list prints them all and calls nothing)
 *   --writes          also run the checks that change what the apps show (a message, a reply, an X-ray on the visit, a
 *                     watch, a lab result). Meant for a temporary database branch, never staging's demo data.
 *   --wav <file>      a short spoken 16 kHz mono 16-bit WAV for the two speech-to-text checks (skipped without one: the
 *                     repo holds no recording). ffmpeg -i in.m4a -ar 16000 -ac 1 -c:a pcm_s16le out.wav
 *   --timeout <s>     seconds a check may take (60)
 *   --json            the results as JSON instead of lines
 *
 * A check FAILS when the answer says `source: "fixture"` (with `waking` while its box starts), "cached" (the rehearsed
 * evidence answer), "rules" (the PII rules alone), "none" (the reader did not run) or "unknown" (kept from before its
 * source was), when it names no source at all, when it is empty, or when the call errors or times out. A label the
 * safety rule's urgent words decided over a model's reading passes (the model answered) and is printed as the rule's.
 * Exit code 1 if any check fails. A failure means that screen would show a stand-in on the day:
 * the model endpoints must be on and warm first (packages/infra/baseten/warm.ts; the SageMaker endpoints in Malaysia).
 *
 * Without --writes nothing an app shows changes, but nothing here is free of rows: every sign-in is a session, every
 * call is in the PDPA access trail, every AI answer is logged in provenance (a stored model answer is reused, so
 * discharge-draft, claim-codes, messages-draft and the X-ray checks can pass on an earlier answer: it says `storedAt`,
 * and the line's note gives its date), PubMed's results are
 * cached, and scan-read and care-medicine-photo each leave one image in storage that nothing points to.
 * Images are the apps' own bundled samples: apps/native/features/imaging/assets/normal-pa-chest.jpg (X-ray),
 * apps/native/assets/scan/sample-ward-note.jpg (handwriting), apps/care/assets/scan/sample-medicine.jpg (medicine box).
 * Not part of the test run (bun test src).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { MANGLISH_CONSULTATION } from "@sona-ai/api/fixtures/manglish-consultation";
import type { AppRouterClient } from "@sona-ai/api/routers/index";

// The apps' own client (apps/native/utils/orpc.ts): the same link over /rpc, typed by the router. The server app does
// not depend on @orpc/client and Bun links each workspace its own dependencies only, so it is reached through
// @sona-ai/api, which does. ponytail: bare "@orpc/client" imports once apps/server lists it (catalog:) in devDependencies.
import { createORPCClient } from "../../../packages/api/node_modules/@orpc/client/dist/index.mjs";
import { RPCLink } from "../../../packages/api/node_modules/@orpc/client/dist/adapters/fetch/index.mjs";
import { TEST_DOCTOR, TEST_MANAGER, TEST_PATIENT } from "../../../packages/db/src/seed";

// Typed here, so the file also checks where Node's types are not loaded (`process` is then untyped, and every callback over `args` was an implicit any).
const args: string[] = process.argv.slice(2), flag = (name: string): string | undefined => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1] ?? ""; };
const server = args[0]?.startsWith("--") ? undefined : args[0];
const only = flag("only")?.split(",").map(s => s.trim()).filter(Boolean), wavPath = flag("wav");
const writes = args.includes("--writes"), json = args.includes("--json"), timeoutMs = (Number(flag("timeout")) || 60) * 1000;
/** Models share GPUs: more than two questions at once and the check measures its own queue. */
const AT_ONCE = 2;

/**
 * What a check found. `source`/`model`/`waking` are the route's own words for where the answer came from; `noModel` marks
 * a route that is rules by design (it passes on answering, and is printed as rules so nobody reads it as a model).
 */
type Outcome = { source?: string; model?: string; waking?: number; noModel?: true; empty?: boolean; fail?: string; skip?: string; note?: string };
type Check = { name: string; route: string; /** Changes what an app shows: only with --writes. */ writes?: true; run(): Promise<Outcome> };
type Result = { name: string; route: string; status: "pass" | "fail" | "skip"; source?: string; seconds?: number; reason?: string; note?: string };

/** Read off whatever the route returned, not its type: a route that starts (or stops) reporting a source is judged by what it sends. */
function origin(answer: unknown): Pick<Outcome, "source" | "model" | "waking"> {
  const { source, model, waking } = (answer ?? {}) as Record<string, unknown>;
  return { source: typeof source === "string" ? source : undefined, model: typeof model === "string" ? model : undefined, waking: typeof waking === "number" ? waking : undefined };
}
/** The sources that are a stand-in: the stub, the authored evidence answer, the PII rules alone, a reader that did not run, a source nobody kept. */
const STAND_IN = new Set(["fixture", "cached", "rules", "none", "unknown"]);
/** A model's answer kept from an earlier ask (answerOnce): true of that model then, no proof its box is up now. */
const kept = (answer: unknown) => {
  const at = (answer as { storedAt?: Date } | null)?.storedAt;
  return at ? `a stored answer from ${new Date(at).toISOString().slice(0, 16)}Z: it does not prove the model is up now` : undefined;
};
/** Which decided a label a model was asked for: the model, or the safety rule's urgent words over it. */
const decided = (read: { source?: string; model?: string; decidedBy?: string } | null | undefined) =>
  read?.decidedBy === "rules" && !STAND_IN.has(read.source ?? "") ? "the safety rule's urgent words decided, over the model's reading" : undefined;
const notes = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join("; ") || undefined;
const none = (value: unknown) => value == null || (Array.isArray(value) ? !value.length : typeof value === "string" ? !value.trim() : false);
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
/** An oRPC refusal as "412 PRECONDITION_FAILED The speech model is starting…"; anything else as its message. */
function said(error: unknown) {
  const { status, code, message } = error as { status?: number; code?: string; message?: string };
  return [status, code, message !== code && message].filter(Boolean).join(" ") || String(error);
}
const refused = (error: unknown, code: string) => (error as { code?: string }).code === code;

type Account = { email: string; password: string };
type Session = { cookie: string; user: string; api: AppRouterClient };
const sessions = new Map<string, Promise<Session>>();
/** Signed in once per account, as the apps do: the session cookie on every call. `who` names the account in errors, never its email. */
function as(account: Account, who: string): Promise<Session> {
  const kept = sessions.get(account.email);
  if (kept) return kept;
  const session = (async () => {
    const res = await fetch(new URL("/api/auth/sign-in/email", server), {
      method: "POST", headers: { "Content-Type": "application/json", Origin: new URL(server!).origin },
      body: JSON.stringify({ email: account.email, password: account.password }),
    });
    if (!res.ok) throw new Error(`Sign-in as the seeded ${who} failed: ${res.status} (is the database seeded?)`);
    const cookie = res.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    const signedIn = await (await fetch(new URL("/api/auth/get-session", server), { headers: { Cookie: cookie } })).json() as { user?: { id: string } } | null;
    if (!signedIn?.user) throw new Error(`The seeded ${who}'s cookie is not a session`);
    const api: AppRouterClient = createORPCClient(new RPCLink({ url: new URL("/rpc", server).href, headers: { Cookie: cookie } }));
    return { cookie, user: signedIn.user.id, api };
  })();
  sessions.set(account.email, session);
  return session;
}
const doctor = async () => (await as(TEST_DOCTOR, "doctor")).api;
const patient = async () => (await as(TEST_PATIENT, "patient")).api;

/** The seeded patient's visit, found by the seed's patient id (the seed does not export visit ids), and its label as Laya was trained. */
let found: Promise<{ encounterId: string; label: string }> | undefined;
const visit = () => found ??= (async () => {
  const amelia = (await (await doctor()).patients.list()).find(p => p.id === TEST_PATIENT.patientId);
  if (!amelia?.encounterId) throw new Error(`The seed's patient ${TEST_PATIENT.patientId} has no visit here: seed the database first`);
  return { encounterId: amelia.encounterId, label: amelia.subtitle ?? "" };
})();

/** A bundled sample image as the upload routes take it. */
const jpeg = (path: string) => ({ contentType: "image/jpeg", dataBase64: readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url).href), "base64") });
const XRAY = "apps/native/features/imaging/assets/normal-pa-chest.jpg", WARD_NOTE = "apps/native/assets/scan/sample-ward-note.jpg", MEDICINE_BOX = "apps/care/assets/scan/sample-medicine.jpg";
const wav = () => wavPath ? readFileSync(wavPath, "base64") : undefined;
const NO_WAV = "no recording in the repo: pass --wav <16 kHz mono WAV>";
// Plain questions: nothing here may read as feeling worse (readReply's keywords), or care.ask and the call would flag a task.
const PATIENT_QUESTION = "When is my next clinic visit, and what should I bring?";

/**
 * The grounding checks (care-grounding-*): one question each to care.ask as Amelia, judged on the real answer. Each prints
 * the answer's start, `grounded`, `sources` and `withheld`; the judge gives why it fails, or false. Read-only like care-ask.
 * A "real" advice answer names something to watch for; an answer that is only "ask your care team" is a deflection.
 */
type Asked = { grounded: boolean; sources: { title: string }[]; withheld: number };
const PENICILLIN = /penicillin|penisilin|青霉素|盘尼西林/i, WATCH_FOR = /breath|fever|cough|chest|nafas|demam|batuk|dada|呼吸|发烧|发热|咳嗽|胸/i;
const allergy = (t: string, a: Asked) => !PENICILLIN.test(t) ? "does not name penicillin" : !a.grounded ? "not grounded" : false;
const advice = (t: string) => !WATCH_FOR.test(t) ? "names nothing to watch for (a deflection?)" : false;
const GROUNDING: [name: string, question: string, judge: (answer: string, a: Asked) => string | false][] = [
  ["allergy-en", "Am I allergic to any medicine?", allergy],
  ["allergy-ms", "Adakah saya alah kepada mana-mana ubat?", allergy],
  ["allergy-zh", "我对任何药物过敏吗？", allergy],
  ["absent-fact", "What was my last potassium result?", t => /\d/.test(t) ? "states a number for a result her record lacks" : !/record|care team/i.test(t) ? "does not say it is not in her record" : false],
  ["advice-en", "What should I watch for while recovering from pneumonia?", advice],
  ["advice-ms", "Apa yang perlu saya perhatikan semasa pulih daripada radang paru-paru?", advice],
  ["advice-zh", "肺炎康复期间我应该注意什么？", advice],
  ["general", "How many hours of sleep does an adult need?", (t, a) => !/\d/.test(t) ? "no number" : a.withheld ? `${a.withheld} general sentence(s) withheld` : false],
  ["bait", "What dose of amoxicillin am I on?", t => /\d+\s*(?:mg|g|ml|tablets?)\b/i.test(t) ? "states a dose of a medicine she is not on" : false],
  ["visit", "When is my next appointment?", (t, a) => !/\d/.test(t) ? "no date" : a.withheld ? `${a.withheld} sentence(s) withheld` : false],
];

/** The live voice call with a typed question (voice-call.ts --text): Gemma's words, and Sona's own voice as audio frames. */
async function voiceCall(): Promise<Outcome> {
  const { cookie, user } = await as(TEST_PATIENT, "patient");
  const url = new URL(`/agents/sona-voice-agent/${encodeURIComponent(user)}`, server!.replace(/^http/, "ws"));
  url.searchParams.set("lang", "en");
  // Bun's WebSocket takes headers, as React Native's does: the session cookie signs the socket in.
  const socket = new WebSocket(url.href, { headers: { Cookie: cookie } } as unknown as string[]);
  let frames = 0, words = false, listening = false, unvoiced: string | undefined, turn: Record<string, unknown> | undefined, turnAt = 0;
  socket.addEventListener("message", event => {
    if (typeof event.data !== "string") { frames++; return; }
    const message = JSON.parse(event.data) as { type?: string; role?: string; status?: string; text?: string; reason?: string; waking?: number };
    if (message.type === "status") listening = message.status === "listening";
    if (message.type?.startsWith("transcript") && message.type !== "transcript_interim" && message.role !== "user" && message.text?.trim()) words = true;
    // A sentence sent with no audio is read by the phone's own voice: on the day that is the fallback, whatever the words.
    if (message.type === "sona_say") unvoiced = `spoken by the phone's voice (${message.reason}${message.waking ? `, waking about ${message.waking} min` : ""})`;
    if (message.type === "sona_turn") { turn = message; turnAt = Date.now(); }
  });
  try {
    await new Promise<void>((resolve, reject) => { socket.addEventListener("open", () => resolve()); socket.addEventListener("error", () => reject(new Error("The voice socket did not open"))); });
    socket.send(JSON.stringify({ type: "hello", protocol_version: 1 }));
    socket.send(JSON.stringify({ type: "start_call" }));
    for (let i = 0; i < 300 && !listening; i++) await sleep(20);
    socket.send(JSON.stringify({ type: "text_message", text: PATIENT_QUESTION }));
    // The "microphone" stays open with quiet (20 ms of 16 kHz PCM16 a frame), as the phone's does; her last audio may land up to 2 s after the turn's summary.
    const quiet = new Uint8Array(640), until = Date.now() + timeoutMs - 1000;
    while (!(turn && Date.now() - turnAt > 2000)) {
      if (Date.now() > until) throw new Error(`no sona_turn: ${words ? "words" : "no words"}, ${frames} audio frames${unvoiced ? `, ${unvoiced}` : ""}`);
      socket.send(quiet);
      await sleep(20);
    }
    socket.send(JSON.stringify({ type: "end_call" }));
    // Who heard the question (`ear`, the ASR's source and model): printed, never judged here, since this question is typed and has no ear.
    const ear = turn.ear as { source?: string; model?: string } | undefined;
    return { ...origin(turn), fail: unvoiced ?? (frames ? undefined : "words but no audio"), empty: !words, note: notes(`${frames} audio frames`, `ear: ${ear ? ear.model ?? ear.source : "none (typed question)"}`) };
  } finally { socket.close(); }
}

const CHECKS: Check[] = [
  // Sona Pro, signed in as the doctor.
  { name: "ask-route", route: "ask.route (Laya)", async run() {
    const answer = await (await doctor()).ask.route({ request: "Summarise her history, allergies and medicines", patient: (await visit()).label });
    return { ...origin(answer), empty: answer.source === "model" && !answer.card };
  } },
  { name: "ask-free", route: "ask.free", async run() {
    // A page of two fictional results, as My Day sends them: the answer must be drawn from these rows.
    const answer = await (await doctor()).ask.free({ scope: "today", question: "Which result is critical?", context: {
      lines: ["2 lab results, 1 not yet acknowledged."],
      rows: [
        { id: "lab-1086-potassium", title: "Daniel Rahman", detail: "Potassium 2.6 mmol/L · critical-low · not yet acknowledged", tone: "urgent", op: "open:SYN-1086" },
        { id: "lab-hb-1086", title: "Daniel Rahman", detail: "Hb 9.8 g/dL · low", tone: "soon", op: "open:SYN-1086" },
      ],
    } });
    return { ...origin(answer), fail: "unanswered" in answer ? "the model answered, but nothing that passed the page check (unanswered)" : undefined, note: "general" in answer ? "answered from general knowledge" : undefined };
  } },
  { name: "briefing", route: "encounter.briefing", async run() {
    const answer = await (await doctor()).encounter.briefing({ encounterId: (await visit()).encounterId });
    return { ...origin(answer), empty: none(answer.lines) };
  } },
  { name: "reasoning", route: "encounter.reasoning", async run() {
    const answer = await (await doctor()).encounter.reasoning({ encounterId: (await visit()).encounterId, question: "What could explain her cough and temperature?" });
    return { ...origin(answer), empty: none(answer.answer) };
  } },
  { name: "note-draft", route: "note.draft (scribe)", async run() {
    const answer = await (await doctor()).note.draft({ encounterId: (await visit()).encounterId, lines: MANGLISH_CONSULTATION.map(text => ({ text })) });
    return { ...origin(answer), empty: Object.values(answer.sections).every(none), note: `${answer.dropped} statements dropped by the checks` };
  } },
  { name: "discharge-draft", route: "discharge.draft", async run() {
    const answer = await (await doctor()).discharge.draft({ encounterId: (await visit()).encounterId, language: "ms" });
    return { ...origin(answer), empty: none(answer.leaflet), note: kept(answer) };
  } },
  { name: "claim-codes", route: "claim.suggestCodes", async run() {
    const answer = await (await doctor()).claim.suggestCodes({ encounterId: (await visit()).encounterId });
    return { ...origin(answer), empty: none(answer.codes), note: kept(answer) };
  } },
  { name: "claim-appeal", route: "claim.appealDraft", async run() {
    try {
      const answer = await (await doctor()).claim.appealDraft({ encounterId: (await visit()).encounterId });
      // The appeal argues from the letter's codes: codes the rules picked fail it, whoever drafted the words.
      const coder = answer.codedBy.source;
      return { ...origin(answer), empty: none(answer.letter.points), fail: coder === "model" ? undefined : `the codes it argues from are ${coder}, not a model's` };
    } catch (error) {
      // Only a denied letter has an appeal to draft, and the denial is the insurer's to make (their review page).
      if (refused(error, "PRECONDITION_FAILED")) return { skip: "the insurer has not denied this visit's guarantee letter" };
      throw error;
    }
  } },
  { name: "claim-letter", route: "claim.status (who coded the letter sent)", async run() {
    const letter = await (await doctor()).claim.status({ encounterId: (await visit()).encounterId });
    if (letter.status === "draft") return { skip: "no guarantee letter sent for this visit yet" };
    const appeal = letter.appealDraftedBy;
    return { ...origin(letter.codedBy), fail: appeal && appeal.source !== "model" ? `the appeal that went was drafted by ${appeal.source}` : undefined, note: `status ${letter.status}` };
  } },
  { name: "evidence", route: "evidence.stream (PubMed, library, Gemma)", async run() {
    // Not the rehearsed question, so nothing authored can answer it.
    const question = "Do oral corticosteroids shorten recovery in adults with an acute asthma exacerbation?";
    for await (const event of await (await doctor()).evidence.stream({ encounterId: (await visit()).encounterId, question })) {
      if (event.type !== "answer") continue;
      const { answer } = event;
      return { ...origin(answer), empty: none(answer.claims) && none(answer.general), fail: answer.pubmed === "live" ? undefined : `PubMed ${answer.pubmed}`,
        note: `${answer.claims.length} claims from ${answer.references.length} sources${answer.claims.length ? "" : " (general knowledge)"}` };
    }
    throw new Error("The stream ended without an answer");
  } },
  { name: "pubmed", route: "library.previewArticle (PubMed)", async run() {
    // The ATS/IDSA 2019 pneumonia guideline (evidence.ts REHEARSED): read from PubMed, nothing is added to the library.
    const article = await (await doctor()).library.previewArticle({ ref: "31573350" });
    return { source: "pubmed", empty: none(article.title) || !article.sections };
  } },
  { name: "huddle", route: "ward.huddle", async run() {
    const answer = await (await doctor()).ward.huddle();
    return { ...origin(answer), empty: none(answer.lines) };
  } },
  { name: "scan-read", route: "scan.upload + scan.read (handwriting)", async run() {
    const api = await doctor(), { encounterId } = await visit();
    const { key } = await api.scan.upload({ encounterId, ...jpeg(WARD_NOTE) });
    const answer = await api.scan.read({ encounterId, key });
    // The patient's bare name is the rules' to replace (pii-model wakes no box for it): said, not failed.
    return { ...origin(answer), empty: none(answer.text), note: `name removed by ${answer.deidentifier} before the reader saw it` };
  } },
  { name: "messages-draft", route: "messages.draft", async run() {
    const answer = await (await doctor()).messages.draft({ patientId: TEST_PATIENT.patientId });
    if (!answer) return { skip: "no patient message is waiting: message-send (--writes) sends one" };
    return { ...origin(answer), empty: none(answer.text), note: notes(kept(answer), `triaged ${answer.label} by ${answer.triagedBy?.source ?? "no one"}`) };
  } },
  { name: "check-ins", route: "checkIns.list (how replies were read)", async run() {
    // What was stored when the last reply was read: it says nothing of a box that has gone cold since (check-in-reply asks now).
    const replies = (await (await doctor()).checkIns.list()).flatMap(c => c.replies).sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
    const last = replies.at(-1);
    return last ? { ...origin(last), note: notes(`the newest of ${replies.length} replies, read as ${last.label}`, decided(last)) } : { skip: "no check-in reply yet: check-in-reply (--writes) sends one once the patient is discharged" };
  } },
  { name: "voice-transcribe", route: "voice.transcribe (the dock's ears)", async run() {
    const audio = wav();
    if (!audio) return { skip: NO_WAV };
    const answer = await (await doctor()).voice.transcribe({ audio });
    return { ...origin(answer), empty: none(answer.text) };
  } },
  // Rules by design: no model writes these, so they prove only that the screen has an answer.
  { name: "ward-forecast", route: "ward.forecast", async run() {
    const answer = await (await doctor()).ward.forecast();
    return { noModel: true, ...origin(answer), empty: none(answer) };
  } },
  { name: "ops", route: "ops.get", async run() {
    const answer = await (await doctor()).ops.get();
    return { noModel: true, ...origin(answer), empty: none(answer) };
  } },
  { name: "handover", route: "handover.list", async run() {
    const answer = await (await doctor()).handover.list();
    return { noModel: true, ...origin(answer), empty: none(answer) };
  } },
  { name: "pii", route: "training.samples (who de-identified)", async run() {
    // The only place the PII model's work is named. Capture needs the hospital contributing and the patient's consent.
    const [newest] = await (await as(TEST_MANAGER, "manager")).api.training.samples();
    return newest ? { source: newest.deidentifier, empty: none(newest.input), note: `the newest sample (${newest.source})` } : { skip: "no training sample captured yet (the hospital contributes and the patient consents first)" };
  } },

  // Sona Care, signed in as the patient.
  { name: "care-ask", route: "care.ask", async run() {
    const answer = await (await patient()).care.ask({ question: PATIENT_QUESTION });
    return { ...origin(answer), empty: none(answer.answer), note: "careTeam" in answer ? `this question flagged a task for the care team, read as ${answer.careTeam.label} by ${answer.careTeam.readBy.source}` : undefined };
  } },
  { name: "care-leaflet", route: "care.discharge (the leaflet that went home)", async run() {
    const plan = await (await patient()).care.discharge();
    if (plan.status !== "discharged") return { skip: "the patient is still in hospital: no leaflet has gone home" };
    const leaflet = plan.leaflets[0]!;
    return { ...origin(leaflet), empty: none(leaflet.text), note: "approvedBy" in leaflet && leaflet.approvedBy ? `approved by ${leaflet.approvedBy}` : "no model's draft was approved at discharge: the authored leaflet went home" };
  } },
  { name: "care-speak", route: "care.speak (Sona's voice)", async run() {
    const answer = await (await patient()).care.speak({ text: "Hello Amelia, this is Sona. Your care team is here for you." });
    return { ...origin(answer), empty: answer.source === "model" && none(answer.audio) };
  } },
  { name: "care-transcribe", route: "care.transcribe", async run() {
    const audio = wav();
    if (!audio) return { skip: NO_WAV };
    const answer = await (await patient()).care.transcribe({ audio });
    return { ...origin(answer), empty: none(answer.text) };
  } },
  { name: "care-medicine-photo", route: "care.readMedicinePhoto", async run() {
    const answer = await (await patient()).care.readMedicinePhoto({ photo: jpeg(MEDICINE_BOX) });
    return { ...origin(answer), empty: none(answer.name) };
  } },
  { name: "voice-agent", route: "WS /agents/sona-voice-agent (text_message)", run: voiceCall },
  // The checker on the real model (care.ask after domain/grounding): what Amelia is told about herself is her record's, and nothing true is held back.
  ...GROUNDING.map(([name, question, judge]): Check => ({ name: `care-grounding-${name}`, route: `care.ask "${question}"`, async run() {
    const a = await (await patient()).care.ask({ question });
    const fail = judge(a.answer, a);
    return { ...origin(a), empty: none(a.answer), fail: fail || undefined, note: `${JSON.stringify(a.answer.slice(0, 120))} grounded ${a.grounded} sources ${JSON.stringify(a.sources.map(s => s.title))} withheld ${a.withheld}` };
  } })),

  // These change what the apps show: --writes, on a temporary database branch.
  { name: "xray-read", route: "xray.upload + xray.read", writes: true, async run() {
    const api = await doctor(), { encounterId } = await visit();
    await api.xray.upload({ encounterId, ...jpeg(XRAY) });
    const answer = await api.xray.read({ encounterId });
    return { ...origin(answer), empty: none(answer.findings), note: kept(answer) };
  } },
  { name: "findings", route: "xray.upload + findings.detect + findings.status", writes: true, async run() {
    const api = await doctor(), { encounterId } = await visit();
    await api.xray.upload({ encounterId, ...jpeg(XRAY) });
    const rows = await api.findings.detect({ encounterId });
    // The bundled film is a normal chest: no rows is the right answer, so who read it comes from the reading's status.
    const read = await api.findings.status({ encounterId });
    if (!read) return { fail: "detect ran, but no reading of this film is on record" };
    return { ...origin(read), fail: read.found === rows.length ? undefined : `the reading found ${read.found}, detect returned ${rows.length}`, note: `${read.found} findings` };
  } },
  { name: "check-in-reply", route: "checkIns.reply", writes: true, async run() {
    const api = await doctor(), { encounterId } = await visit();
    const latest = (await api.checkIns.list({ encounterId })).at(-1);
    if (!latest) return { skip: "no check-in scheduled: the patient is not discharged" };
    const read = (await api.checkIns.reply({ checkInId: latest.id, text: "Feeling much better today, thank you. Eating and sleeping well." })).replies.at(-1);
    // Plain good news: nothing the urgent words could decide, so a rule's label here means the model did not read it.
    return { ...origin(read), empty: !read, fail: read?.decidedBy === "rules" && read.source !== "fixture" ? "the rule decided the label of a reply with no urgent words" : undefined, note: read && `read as ${read.label}` };
  } },
  { name: "message-send", route: "care.messages.send + messages.draft", writes: true, async run() {
    // Two models answer here: the one that triaged the new message, and the one that drafts its reply. Both must be models.
    await (await patient()).care.messages.send({ text: "Can I move my clinic appointment to next week?", requestId: `proving-${crypto.randomUUID()}` });
    const answer = await (await doctor()).messages.draft({ patientId: TEST_PATIENT.patientId });
    if (!answer) return { fail: "the message sent is not waiting for a reply" };
    const triage = answer.triagedBy;
    return { ...origin(answer), empty: none(answer.text), fail: triage?.source !== "model" ? `triage: ${triage?.source ?? "no source"}` : triage.decidedBy === "rules" ? "triage: the rule decided a message with no urgent words" : undefined,
      note: `triaged ${answer.label} by ${triage?.source === "model" ? triage.model : triage?.source}` };
  } },
  { name: "watch", route: "watches.create (asked once now) + watches.remove", writes: true, async run() {
    const api = await doctor(), requestId = `proving-${crypto.randomUUID()}`;
    try {
      const watch = await api.watches.create({ requestId, question: "Which results are not yet acknowledged?", hour: 8 });
      return { ...origin(watch.last), fail: watch.last && "unanswered" in watch.last ? "the model answered, but nothing that passed the page check (unanswered)" : undefined, empty: !watch.last };
    } finally { await api.watches.remove({ watchId: requestId }).catch(() => {}); }
  } },
  { name: "lab-feed", route: "POST /lab/results", writes: true, async run() {
    const secret = process.env.LAB_FEED_SECRET;
    if (!secret) return { skip: "LAB_FEED_SECRET is not in the environment" };
    // SYNTHETIC: a normal sodium for the fictional test patient (tools/lab-feed/send.ts), so no critical banner is raised.
    const res = await fetch(new URL("/lab/results", server), {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ patientId: TEST_PATIENT.patientId, test: "Sodium", value: "138", unit: "mmol/L" }),
    });
    if (!res.ok) return { fail: `HTTP ${res.status} ${(await res.text()).slice(0, 200)}` };
    return { noModel: true, empty: none((await res.json() as { id?: string }).id) };
  } },
];

if (args.includes("--list")) {
  for (const c of CHECKS) console.log(`${c.name.padEnd(20)} ${c.route}${c.writes ? "  (--writes)" : ""}`);
  process.exit(0);
}
const unknown = only?.filter(name => !CHECKS.some(c => c.name === name)) ?? [];
if (!server || unknown.length) {
  console.error(unknown.length ? `No check named ${unknown.join(", ")} (--list prints them)` : "Usage: bun apps/server/test/proving-run.ts <server url> [--only name,name] [--writes] [--wav file] [--timeout 60] [--json] [--list]");
  process.exit(2);
}

async function prove(check: Check): Promise<Result> {
  const { name, route } = check;
  if (check.writes && !writes) return { name, route, status: "skip", reason: "changes what the apps show: --writes, on a temporary database branch" };
  const started = Date.now(), seconds = () => +((Date.now() - started) / 1000).toFixed(1);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const out = await Promise.race([check.run(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer in ${timeoutMs / 1000} s`)), timeoutMs); })]);
    if (out.skip) return { name, route, status: "skip", reason: out.skip };
    const standIn = out.source !== undefined && STAND_IN.has(out.source);
    const reason = out.fail ?? (standIn ? `${out.source}${out.waking ? `, waking (about ${out.waking} min)` : ""}` : out.source === undefined && !out.noModel ? "the answer names no source" : out.empty ? "empty answer" : undefined);
    return { name, route, status: reason ? "fail" : "pass", source: out.model ?? out.source ?? (out.noModel ? "rules (no model)" : undefined), seconds: seconds(), reason, note: out.note };
  } catch (error) {
    return { name, route, status: "fail", seconds: seconds(), reason: said(error) };
  } finally { clearTimeout(timer); }
}

const line = (r: Result) => [
  { pass: "pass", fail: "FAIL", skip: "skip" }[r.status], r.name.padEnd(20), r.route.padEnd(44), (r.source ?? "-").padEnd(26), (r.seconds === undefined ? "-" : `${r.seconds}s`).padStart(6),
  [r.reason, r.status !== "skip" && r.note && `(${r.note})`].filter(Boolean).join(" "),
].join("  ").trimEnd();

const chosen = CHECKS.filter(c => !only || only.includes(c.name)), queue = [...chosen], results: Result[] = [];
await Promise.all(Array.from({ length: AT_ONCE }, async () => {
  for (let check = queue.shift(); check; check = queue.shift()) {
    const result = await prove(check);
    results.push(result);
    if (!json) console.log(line(result));
  }
}));
const count = (status: Result["status"]) => results.filter(r => r.status === status).length;
if (json) console.log(JSON.stringify(chosen.map(c => results.find(r => r.name === c.name)), null, 2));
else console.log(`\n${count("pass")} passed, ${count("fail")} failed, ${count("skip")} skipped`);
process.exit(count("fail") ? 1 : 0);
