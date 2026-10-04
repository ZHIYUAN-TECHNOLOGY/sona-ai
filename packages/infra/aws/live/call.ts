/**
 * A live call to box ④ on its SageMaker endpoint, made the way the Worker makes it (sagemakerLive: requests up, one
 * streamed reply down): plays a recorded question in real time as the phone would, then quiet, and prints what Sona
 * decides each second, when her first words and first sound come, and saves her voice. Synthetic audio only.
 *
 *   CREDS=$(aws configure export-credentials --profile sona --format process) bun packages/infra/aws/live/call.ts question.wav [reply.wav]
 * Env: ENDPOINT (default sona-live), TAIL (seconds of quiet after the question, default 10), SYSTEM (the call's brief).
 */
import { readFileSync, writeFileSync } from "node:fs";

import { sagemakerLive } from "../../../api/src/sagemaker";

const c = JSON.parse(process.env.CREDS!) as { AccessKeyId: string; SecretAccessKey: string; SessionToken?: string };
const file = readFileSync(process.argv[2]!), data = file.indexOf("data") + 8; // 16 kHz mono PCM16, as check.py's question
const tail = Number(process.env.TAIL ?? 10), pcm = Buffer.concat([file.subarray(data), Buffer.alloc(tail * 32_000)]);
const link = sagemakerLive({ region: "ap-southeast-5", accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken }, process.env.ENDPOINT ?? "sona-live");

let t0 = 0, words: number | undefined, sound: number | undefined, said = "";
const voice: Buffer[] = [], at = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5);
const questionEnds = () => t0 + (pcm.length / 32_000 - tail) * 1000;
const ready = new Promise<void>(go => {
  link.onmessage = message => {
    if (typeof message !== "string") { sound ??= Date.now(); voice.push(Buffer.from(message)); return; }
    const m = JSON.parse(message) as { type: string; i?: number; listen?: boolean; text?: string; ms?: number; behind?: number; end_of_turn?: boolean };
    if (m.type === "ready") return go();
    if (m.type === "voice") return console.log(`${at()}s voice of unit ${m.i}, made in ${m.ms} ms`);
    if (m.type !== "unit") return console.log(`${at()}s`, message.slice(0, 200));
    if (!m.listen) { words ??= Date.now(); said += m.text; }
    if (!m.listen || m.behind) console.log(`${at()}s unit ${String(m.i).padStart(3)} ${m.listen ? "listen" : "SPEAK "} ${m.ms} ms behind ${m.behind} ${JSON.stringify(m.text)}${m.end_of_turn ? " [end of turn]" : ""}`);
  };
});
link.onclose = () => console.log(`${at()}s the box closed the call`);
const opening = Date.now();
link.send(JSON.stringify({ type: "start", voice: "v1", system: process.env.SYSTEM ?? "You are Sona Care, a hospital's assistant for its patients, talking with one patient by voice. Answer in at most 3 short sentences." }));
await ready;
console.log(`call open in ${((Date.now() - opening) / 1000).toFixed(1)} s`);
t0 = Date.now();
for (let i = 0; i < pcm.length; i += 3200) { // 100 ms frames, at the speed a phone sends them
  link.send(new Uint8Array(pcm.subarray(i, i + 3200)).buffer);
  await new Promise(done => setTimeout(done, Math.max(0, t0 + (i + 3200) / 32 - Date.now())));
}
await new Promise(done => setTimeout(done, 3000));
link.close();
console.log("Sona said:", said.trim());
if (words) console.log(`first words ${((words - questionEnds()) / 1000).toFixed(1)} s after the question ended${sound ? `, first sound ${((sound - questionEnds()) / 1000).toFixed(1)} s` : ""}`);
if (voice.length && process.argv[3]) {
  const samples = Buffer.concat(voice), header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(36 + samples.length, 4); header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(24_000, 24); header.writeUInt32LE(48_000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(samples.length, 40);
  writeFileSync(process.argv[3], Buffer.concat([header, samples]));
  console.log(`her voice: ${process.argv[3]} (${(samples.length / 48_000).toFixed(1)} s)`);
}
setTimeout(() => process.exit(0), 1500);
