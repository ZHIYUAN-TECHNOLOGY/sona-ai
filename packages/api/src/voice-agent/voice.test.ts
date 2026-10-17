import { expect, test } from "bun:test";

import { ASR_MODEL, BOXES, BRAIN_MODEL, boxState } from "../baseten-models";
import { SonaVoice, warmBoxes, type PhoneVoice, type Speak, type Spoken } from "./voice";

const MP3 = Uint8Array.from([0xff, 0xfb, 0x90, 0x64, ...Array(60).fill(7)]);
/** A box that holds the request until it is aborted, like a slow box. */
const hanging = (seen: AbortSignal[]): Speak => (_text, signal) => {
  seen.push(signal);
  return new Promise<Spoken>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
};

test("a sentence in Sona's voice comes back as the box's MP3", async () => {
  const told: PhoneVoice[] = [];
  const voice = new SonaVoice(async () => ({ audio: MP3 }), said => told.push(said));
  const audio = await voice.synthesize("Ambil ubat selepas makan.", new AbortController().signal);
  expect(new Uint8Array(audio!)).toEqual(MP3);
  expect(told).toEqual([]);
});

test("while the voice starts, the phone reads the sentence and the rest of that turn; the next turn tries the voice again", async () => {
  const told: [PhoneVoice, AbortSignal | undefined][] = [];
  let asked = 0;
  const voice = new SonaVoice(async () => { asked++; return { waking: 25 }; }, (said, turn) => told.push([said, turn]));
  const turn = new AbortController().signal;
  expect(await voice.synthesize("Satu.", turn)).toBeNull();
  expect(await voice.synthesize("Dua.", turn)).toBeNull();
  expect([asked, told]).toEqual([1, [[{ text: "Satu.", reason: "starting", waking: 25 }, turn], [{ text: "Dua.", reason: "starting", waking: 25 }, turn]]]);
  await voice.synthesize("Tiga.", new AbortController().signal);
  expect(asked).toBe(2);
});

test("a voice slower than its budget is cut off and the phone reads instead; a failing one too", async () => {
  const seen: AbortSignal[] = [], told: PhoneVoice[] = [];
  const slow = new SonaVoice(hanging(seen), said => told.push(said), 30);
  const started = Date.now();
  expect(await slow.synthesize("Your plan says rest.", new AbortController().signal)).toBeNull();
  expect(Date.now() - started).toBeLessThan(1000);
  expect([seen[0]!.aborted, told]).toEqual([true, [{ text: "Your plan says rest.", reason: "slow" }]]);
  // Even a box that ignores the abort cannot hold the sentence past the budget.
  const deaf = new SonaVoice(() => new Promise<Spoken>(() => {}), said => told.push(said), 30);
  expect(await deaf.synthesize("Rest.", new AbortController().signal)).toBeNull();
  const failing = new SonaVoice(async () => { throw new Error("Baseten voice answered 500"); }, said => told.push(said));
  expect(await failing.synthesize("Drink water.", new AbortController().signal)).toBeNull();
  expect(told.slice(1)).toEqual([{ text: "Rest.", reason: "slow" }, { text: "Drink water.", reason: "unavailable" }]);
});

test("only an answer's first sentence is held to the budget; a later one is made while the one before plays, so it gets twice as long", async () => {
  const seen: AbortSignal[] = [];
  const voice = new SonaVoice((text, signal) => text === "Satu." ? Promise.resolve({ audio: MP3 }) : hanging(seen)(text, signal), () => {}, 50);
  const turn = new AbortController().signal;
  expect(await voice.synthesize("Satu.", turn)).not.toBeNull();
  const started = Date.now();
  expect(await voice.synthesize("Dua.", turn)).toBeNull();
  expect(Date.now() - started).toBeGreaterThanOrEqual(95);
});

test("an interruption cancels the sentence in flight: its request is aborted and nothing is played or read", async () => {
  const seen: AbortSignal[] = [], told: PhoneVoice[] = [];
  const voice = new SonaVoice(hanging(seen), said => told.push(said));
  const turn = new AbortController();
  const pending = voice.synthesize("Your follow-up is on 12 October.", turn.signal);
  await Bun.sleep(5);
  turn.abort();
  expect(await pending).toBeNull();
  expect([seen[0]!.aborted, told]).toEqual([true, []]);
  // An already interrupted turn asks the box for nothing.
  expect(await voice.synthesize("Rest.", turn.signal)).toBeNull();
  expect(seen.length).toBe(1);
});

test("when the phone connects, each box that is up gets one tiny request per path a turn takes; one that is down gets nothing more", async () => {
  /** Boxes up or down; every request as box and route, its body kept. */
  const asked = (up: Record<"voice" | "brain", boolean>) => {
    const calls: { to: string; body?: BodyInit | null }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      const box = url.includes(BOXES.voice) ? "voice" : "brain";
      calls.push({ to: `${box} ${url.split("/environments/production")[1]}`, body: init?.body });
      if (!up[box]) return new Response("starting", { status: 503 });
      return url.endsWith("/v1/tts") ? new Response(MP3, { headers: { "content-type": "audio/mpeg" } }) : Response.json({ text: "", choices: [] });
    }) as typeof fetch;
    return { fetcher, calls };
  };
  boxState.clear();
  const voiceOnly = asked({ voice: true, brain: false });
  await warmBoxes({ apiKey: "k", fetcher: voiceOnly.fetcher });
  expect(voiceOnly.calls.map(c => c.to).sort()).toEqual(["brain /sync/health", "voice /sync/health", "voice /sync/v1/audio/transcriptions", "voice /sync/v1/tts"]);
  const [hear, speak] = ["voice /sync/v1/audio/transcriptions", "voice /sync/v1/tts"].map(to => voiceOnly.calls.find(c => c.to === to)!.body);
  expect([(hear as FormData).get("model"), ((hear as FormData).get("file") as Blob).size, JSON.parse(speak as string)]).toEqual([ASR_MODEL, 44 + 16_000, { text: "Hai." }]);
  // Box ② is now known up in this isolate, so the call's first turn skips its health check.
  expect(boxState.get("voice")!.readyUntil).toBeGreaterThan(Date.now());

  boxState.clear();
  const both = asked({ voice: true, brain: true });
  await warmBoxes({ apiKey: "k", fetcher: both.fetcher });
  const chat = JSON.parse(both.calls.find(c => c.to === "brain /sync/v1/chat/completions")!.body as string);
  expect([both.calls.length, chat.model, chat.max_tokens]).toEqual([5, BRAIN_MODEL, 1]);
});

test("her voice as it is made: pieces go on as whole samples of 50 ms or more, a sentence with no sound falls to the phone, an interruption ends it", async () => {
  const read: PhoneVoice[] = [];
  const pieces = (sizes: number[]) => async function* () { for (const n of sizes) yield new Uint8Array(n); };
  const collect = async (v: SonaVoice, turn?: AbortSignal) => { const out: number[] = []; for await (const p of v.synthesizeStream("Hai.", turn)) out.push(p.byteLength); return out; };
  // 3001 + 3000 bytes: under 50 ms (4800 bytes) at first, then 6000 whole; the odd byte and the rest follow at the end.
  const v = new SonaVoice(async () => ({}), said => read.push(said), 50, pieces([3001, 3000, 1001]));
  expect(await collect(v)).toEqual([6000, 1002]);
  expect(read).toEqual([]);
  // No sound at all, with the box starting: the phone reads it, and the rest of that turn.
  const turn = new AbortController();
  const cold = new SonaVoice(async () => ({}), said => read.push(said), 50, async function* () { return { waking: 12 }; });
  expect(await collect(cold, turn.signal)).toEqual([]);
  expect(await collect(cold, turn.signal)).toEqual([]);
  expect(read).toEqual([{ text: "Hai.", reason: "starting", waking: 12 }, { text: "Hai.", reason: "starting", waking: 12 }]);
  // Interrupted mid-sentence: no more pieces, nothing read.
  const cut = new AbortController(), before = read.length;
  const slow = new SonaVoice(async () => ({}), said => read.push(said), 50, async function* () { yield new Uint8Array(4800); cut.abort(); yield new Uint8Array(4800); });
  expect(await collect(slow, cut.signal)).toEqual([4800]);
  expect(read.length).toBe(before);
});
