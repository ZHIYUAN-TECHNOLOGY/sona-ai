/**
 * Which voice says another model's words sooner, on the one machine in Malaysia (test.sh): box ④ told what to say
 * ("say", a second at a time), or box ②'s VoxCPM2 as it makes the line (its stream). For each line: seconds from asking
 * to the first sound, to the last, and the seconds of sound made.
 *
 * Measured 4 Oct (first sound, whole line, both warm): VoxCPM2 0.14-0.18 s and 1.6-1.9 s for 5-6 s of sound;
 * box ④ 2.1-2.2 s and 5.5-7.7 s. So another model's words are VoxCPM2's to say.
 *
 *   CREDS=$(aws configure export-credentials --profile sona --format process) bun packages/infra/aws/live/voices.ts [out dir]
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { payloads, sagemakerLive, signed } from "../../../api/src/sagemaker";

const c = JSON.parse(process.env.CREDS!) as { AccessKeyId: string; SecretAccessKey: string; SessionToken?: string };
const aws = { region: "ap-southeast-5", accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken };
const endpoint = process.env.ENDPOINT ?? "sona-live", out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });
const LINES = {
  en: "You can take paracetamol for your fever. Take 1 gram every 6 hours if you need it.",
  ms: "Anda boleh ambil paracetamol satu gram setiap enam jam jika perlu.",
  zh: "您可以服用扑热息痛退烧，每六小时一克。",
};
const s = (ms: number) => (ms / 1000).toFixed(2);
const wav = (pcm: Uint8Array, rate: number) => {
  const h = Buffer.alloc(44);
  h.write("RIFF"); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
};

/** Box ②'s voice, streamed. */
async function voxcpm(lang: string, text: string) {
  const url = `https://runtime.sagemaker.${aws.region}.amazonaws.com/endpoints/${endpoint}/invocations-response-stream`;
  const body = new TextEncoder().encode(JSON.stringify({ text, stream: true })), t = Date.now();
  const res = await fetch(url, { method: "POST", body, headers: { ...await signed(aws, "sagemaker", url, body, "application/json", new Date()), "x-amzn-sagemaker-custom-attributes": "voice" } });
  if (!res.ok) return console.log(`VoxCPM2 ${lang}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  let first = 0, bytes = 0;
  const parts: Uint8Array[] = [];
  for await (const piece of res.body!.pipeThrough(payloads()) as unknown as AsyncIterable<Uint8Array>) { first ||= Date.now() - t; bytes += piece.length; parts.push(piece); }
  console.log(`VoxCPM2   ${lang}: first sound ${s(first)} s, done ${s(Date.now() - t)} s, ${(bytes / 96_000).toFixed(1)} s of sound`);
  if (out) writeFileSync(`${out}/voxcpm-${lang}.wav`, wav(Buffer.concat(parts), 48_000));
}

/** Box ④ held to listening, told the line two seconds into a quiet call. */
async function sona(lang: string, text: string) {
  const link = sagemakerLive(aws, endpoint), parts: Buffer[] = [];
  let ready = () => {}, over = () => {}, asked = 0, first = 0, last = 0;
  const opened = new Promise<void>(go => { ready = go; }), ended = new Promise<void>(go => { over = go; });
  link.onmessage = m => {
    if (typeof m !== "string") { first ||= Date.now() - asked; last = Date.now() - asked; parts.push(Buffer.from(m)); return; }
    const u = JSON.parse(m) as { type: string; end_of_turn?: boolean; scripted?: boolean };
    if (u.type === "ready") ready();
    if (u.type === "unit" && u.scripted && u.end_of_turn) setTimeout(over, 1500);
  };
  link.send(JSON.stringify({ type: "start", voice: "v1", hold: true, system: "Streaming Omni Conversation." }));
  await opened;
  const t0 = Date.now(), quiet = new Uint8Array(3200).buffer;
  let going = true;
  void (async () => { for (let i = 0; going; i++) { link.send(quiet); await new Promise(d => setTimeout(d, Math.max(0, t0 + (i + 1) * 100 - Date.now()))); } })();
  await new Promise(d => setTimeout(d, 2300));
  asked = Date.now();
  link.send(JSON.stringify({ type: "say", text, rate: 4 }));
  await Promise.race([ended, new Promise(d => setTimeout(d, 40_000))]);
  going = false;
  link.close();
  const pcm = Buffer.concat(parts);
  console.log(`sona-live ${lang}: first sound ${s(first)} s, done ${s(last)} s, ${(pcm.length / 48_000).toFixed(1)} s of sound`);
  if (out) writeFileSync(`${out}/sona-${lang}.wav`, wav(pcm, 24_000));
  await new Promise(d => setTimeout(d, 1500));
}

for (const [lang, text] of Object.entries(LINES)) { await voxcpm(lang, text); await voxcpm(lang, text); }
for (const [lang, text] of Object.entries(LINES)) await sona(lang, text);
process.exit(0);
