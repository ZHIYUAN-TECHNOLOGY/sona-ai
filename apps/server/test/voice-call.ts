/**
 * Calls Sona Care's live voice agent (src/agents/voice.ts) the way the phone does, from a WAV file. It signs in as the
 * synthetic demo patient (TEST_PATIENT, Amelia), opens /agents/sona-voice-agent/<her user id>, starts a call, streams the
 * WAV as 16 kHz PCM16 mono in 20 ms frames at real time, keeps the "microphone" open with quiet so the agent hears the
 * turn end, and prints every event with the time since the patient last stopped speaking. Binary frames are Sona's
 * sentences as MP3.
 *
 *   bun apps/server/test/voice-call.ts <server url> <16 kHz mono 16-bit WAV> [options]
 *   bun apps/server/test/voice-call.ts https://sona-ai-server-staging-uxfqzyce5rxhzsju.zhiyuantech.workers.dev ~/zyt/data/sona-asr/real_voice/01.wav --lang ms
 *
 * Options:
 *   --lang en|ms|zh      the app's language (Sona's own lines, and Gemma's when the patient mixes languages)
 *   --text "..."         a typed question instead of a WAV (text_message)
 *   --then <wav>         talk over Sona once her first sentence arrives (the SDK's barge-in), then wait for that answer
 *   --interrupt <ms>     send "interrupt" this long after the first sentence arrives, as a patient cutting in
 *   --save <dir>         keep the MP3s (or, from the live call on MiniCPM-o, its PCM as one sona.wav)
 *   --cookie "<Cookie>"  an existing session instead of signing in; --no-sign-in for a local harness with no auth
 * Other audio: ffmpeg -i in.m4a -ar 16000 -ac 1 -c:a pcm_s16le out.wav
 * Not part of the test run (bun test src). The boxes must be awake for model answers (packages/infra/baseten/warm.ts).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { TEST_PATIENT } from "../../../packages/db/src/seed";

const args = process.argv.slice(2), flag = (name: string) => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1] ?? ""; };
const server = args[0], wavPath = args[1]?.startsWith("--") ? undefined : args[1];
const text = flag("text"), lang = flag("lang"), thenPath = flag("then"), interruptMs = flag("interrupt"), saveDir = flag("save");
if (!server || (!wavPath && !text)) {
  console.error("Usage: bun apps/server/test/voice-call.ts <server url> <wav> [--lang ms] [--text '...'] [--then <wav>] [--interrupt 1500] [--save dir] [--cookie '...'] [--no-sign-in]");
  process.exit(1);
}

/** The PCM16 bytes of a 16 kHz mono WAV (the format the phone streams). */
function pcmOf(path: string) {
  const file = readFileSync(path), view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let at = 12, format: { rate: number; channels: number; bits: number } | undefined;
  while (at + 8 <= file.length) {
    const id = file.toString("ascii", at, at + 4), size = view.getUint32(at + 4, true);
    if (id === "fmt ") format = { channels: view.getUint16(at + 10, true), rate: view.getUint32(at + 12, true), bits: view.getUint16(at + 22, true) };
    if (id === "data") {
      if (format?.rate !== 16_000 || format.channels !== 1 || format.bits !== 16) throw new Error(`Need 16 kHz mono 16-bit PCM, got ${JSON.stringify(format)}; convert with ffmpeg (see the header)`);
      return new Uint8Array(file.subarray(at + 8, at + 8 + size));
    }
    at += 8 + size + (size % 2);
  }
  throw new Error("No data chunk in the WAV");
}

/** The session cookie and its user id (the agent's path names the signed-in account). */
async function signIn(): Promise<{ cookie?: string; user: string }> {
  if (args.includes("--no-sign-in")) return { user: "harness" };
  let cookie = flag("cookie");
  if (!cookie) {
    const res = await fetch(new URL("/api/auth/sign-in/email", server), {
      method: "POST", headers: { "Content-Type": "application/json", Origin: new URL(server).origin },
      body: JSON.stringify({ email: TEST_PATIENT.email, password: TEST_PATIENT.password }),
    });
    if (!res.ok) throw new Error(`Sign-in failed: ${res.status} ${await res.text()}`);
    cookie = res.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  }
  const session = await (await fetch(new URL("/api/auth/get-session", server), { headers: { Cookie: cookie } })).json() as { user?: { id: string } } | null;
  if (!session?.user) throw new Error("The cookie is not a session");
  return { cookie, user: session.user.id };
}

const FRAME = 640; // 20 ms of 16 kHz PCM16
const { cookie, user } = await signIn();
const url = new URL(`/agents/sona-voice-agent/${encodeURIComponent(user)}`, server.replace(/^http/, "ws"));
if (lang) url.searchParams.set("lang", lang);
// Bun's WebSocket takes headers, as React Native's does: the session cookie signs the socket in.
const socket = new WebSocket(url, { headers: cookie ? { Cookie: cookie } : {} } as unknown as string[]);
socket.binaryType = "arraybuffer";

let spokeAt = Date.now(), firstAudio = 0, sentences = 0, answered = 0, listening = false;
let marks: Record<string, number> = {};
// The live call on MiniCPM-o (src/agents/live.ts) sends raw PCM16 a second a frame (audio_config pcm16, 24 kHz), not MP3.
let format = "mp3", rate = 16_000;
const pcm: Uint8Array[] = [];
const since = () => `${((Date.now() - spokeAt) / 1000).toFixed(2)}s`;
const mark = (name: string) => { marks[name] ??= Date.now() - spokeAt; };

socket.addEventListener("message", async event => {
  // Bun hands a binary frame over as an ArrayBuffer or, from a local workerd, as a Blob.
  if (typeof event.data !== "string") {
    const bytes = new Uint8Array(event.data instanceof Blob ? await event.data.arrayBuffer() : event.data);
    sentences++;
    if (!firstAudio) firstAudio = Date.now();
    mark("first audio");
    console.log(`${since()}  audio #${sentences} ${bytes.byteLength} bytes`);
    if (format === "pcm16") pcm.push(bytes);
    else if (saveDir) { mkdirSync(saveDir, { recursive: true }); writeFileSync(join(saveDir, `sentence-${sentences}.mp3`), bytes); }
    return;
  }
  const message = JSON.parse(String(event.data)), { type, ...rest } = message;
  if (type === "audio_config") { format = message.format; rate = message.sampleRate ?? 16_000; }
  if (type === "transcript" && message.role === "user") mark("heard");
  if (type === "transcript_delta") mark("first words");
  if (type === "sona_say") mark("first phone line");
  if (type === "sona_turn") { mark("answered"); answered++; }
  if (type === "status") listening = message.status === "listening";
  console.log(`${since()}  ${type} ${JSON.stringify(rest)}`);
});
socket.addEventListener("close", event => console.log(`closed ${event.code} ${event.reason}`));
await new Promise<void>((resolve, reject) => { socket.addEventListener("open", () => resolve()); socket.addEventListener("error", () => reject(new Error("WebSocket failed"))); });
socket.send(JSON.stringify({ type: "hello", protocol_version: 1 }));
socket.send(JSON.stringify({ type: "start_call" }));
for (let i = 0; i < 300 && !listening; i++) await Bun.sleep(20);

/** What the microphone sends next, 20 ms at a time; quiet when it is empty. */
const frames: Uint8Array[] = [], quiet = new Uint8Array(FRAME);
const say = (pcm: Uint8Array) => { for (let at = 0; at < pcm.length; at += FRAME) frames.push(pcm.slice(at, at + FRAME)); };
if (text) socket.send(JSON.stringify({ type: "text_message", text }));
else say(pcmOf(wavPath!));

let barged = false, interruptedAt = 0, doneTicks = 0;
const start = Date.now(), wanted = 1;
for (let tick = 0; tick < 90 * 50 && doneTicks < 100; tick++) {
  const frame = frames.shift();
  socket.send(frame ?? quiet);
  if (frame && !frames.length) { spokeAt = Date.now(); marks = {}; console.log(`${since()}  (patient stops speaking)`); }
  if (thenPath && firstAudio && !barged) { barged = true; answered = 0; console.log(`${since()}  -> the patient talks over Sona`); say(pcmOf(thenPath)); }
  if (interruptMs && firstAudio && !interruptedAt && Date.now() - firstAudio >= Number(interruptMs)) {
    interruptedAt = Date.now();
    console.log(`${since()}  -> interrupt`);
    socket.send(JSON.stringify({ type: "interrupt" }));
  }
  const done = interruptedAt ? Date.now() - interruptedAt > 3000 : answered >= wanted && (!thenPath || barged);
  if (done) doneTicks++;
  await Bun.sleep(Math.max(0, start + (tick + 1) * 20 - Date.now()));
}
socket.send(JSON.stringify({ type: "end_call" }));
await Bun.sleep(300);
socket.close();
if (saveDir && pcm.length) {
  const data = Buffer.concat(pcm), header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(data.length, 40);
  mkdirSync(saveDir, { recursive: true });
  writeFileSync(join(saveDir, "sona.wav"), Buffer.concat([header, data]));
  console.log(`saved ${join(saveDir, "sona.wav")} (${(data.length / 2 / rate).toFixed(1)} s)`);
}
console.log("\nSeconds after the patient last stopped speaking:", Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, +(v / 1000).toFixed(2)])), `· ${sentences} MP3 sentences in all`);
process.exit(0);
