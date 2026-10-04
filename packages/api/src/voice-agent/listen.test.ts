import { expect, test } from "bun:test";

import { RATE, SonaTranscriber, TurnDetector, wav, type Heard, type TurnEvent } from "./listen";

/** Synthetic speech: a 220 Hz tone at a third of full scale (about -13 dBFS); quiet is faint hiss (about -60 dBFS). */
const tone = (ms: number) => Int16Array.from({ length: (RATE * ms) / 1000 }, (_, i) => Math.round(11_000 * Math.sin((2 * Math.PI * 220 * i) / RATE)));
const quiet = (ms: number) => Int16Array.from({ length: (RATE * ms) / 1000 }, (_, i) => (i % 7) * 6 - 18);
const pcm = (...parts: Int16Array[]) => { const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
const ms = (samples: Int16Array) => (samples.length / RATE) * 1000;
/** Feeds the detector in 100 ms chunks, as a phone streams. */
function run(detector: TurnDetector, samples: Int16Array) {
  const events: TurnEvent[] = [];
  for (let at = 0; at < samples.length; at += RATE / 10) events.push(...detector.push(samples.subarray(at, at + RATE / 10)));
  return events;
}
const bytes = (samples: Int16Array) => { const out = new Uint8Array(samples.length * 2), view = new DataView(out.buffer); samples.forEach((s, i) => view.setInt16(i * 2, s, true)); return out; };

test("a turn is speech then 0.7 s of quiet: it starts once there is 0.3 s of speech, and keeps the start and a little of the quiet", () => {
  const events = run(new TurnDetector(), pcm(quiet(500), tone(1000), quiet(1000)));
  expect(events.map(e => e.type)).toEqual(["start", "end"]);
  const turn = (events[1] as Extract<TurnEvent, { type: "end" }>).pcm;
  // All the speech is in it (nothing clipped at the start), with 0.2 s of quiet kept at the end, not the whole 0.7 s.
  const loud = turn.filter(s => Math.abs(s) > 1000).length;
  expect(loud).toBeGreaterThan(0.95 * (RATE - RATE / 10)); // a sine is above 1000 most of the time
  expect(ms(turn)).toBeGreaterThan(1000 + 200);
  expect(ms(turn)).toBeLessThanOrEqual(500 + 1000 + 200);
  expect(Math.max(...turn.subarray(turn.length - (RATE * 200) / 1000).map(Math.abs))).toBeLessThan(100);
});

test("a short pause does not end the turn; a cough or a click never starts one", () => {
  const paused = run(new TurnDetector(), pcm(tone(800), quiet(500), tone(800), quiet(900)));
  expect(paused.map(e => e.type)).toEqual(["start", "end"]);
  expect(ms((paused[1] as Extract<TurnEvent, { type: "end" }>).pcm)).toBeGreaterThan(2000);
  expect(run(new TurnDetector(), pcm(quiet(300), tone(200), quiet(1500), tone(120), quiet(1500)))).toEqual([]);
});

test("a monologue is cut at 30 s and still sent, and what follows is the next turn; the knobs move the thresholds", () => {
  const events = run(new TurnDetector(), tone(31_000));
  expect(events.map(e => e.type)).toEqual(["start", "end", "start"]);
  expect(ms((events[1] as Extract<TurnEvent, { type: "end" }>).pcm)).toBe(30_000);
  // A quieter room's threshold hears a softer voice; a longer quiet lets a slow speaker pause.
  const soft = pcm(tone(1000).map(s => s / 100), quiet(1000));
  expect(run(new TurnDetector(), soft)).toEqual([]);
  expect(run(new TurnDetector({ speechDb: -55 }), soft).map(e => e.type)).toEqual(["start", "end"]);
  expect(run(new TurnDetector({ quietMs: 1200 }), pcm(tone(800), quiet(1000))).map(e => e.type)).toEqual(["start"]);
});

test("WAV: a 44-byte RIFF header for 16 kHz mono 16-bit, then the samples little-endian", () => {
  const out = wav(Int16Array.from([1, -2, 300]));
  const view = new DataView(out.buffer), text = (at: number) => String.fromCharCode(...out.subarray(at, at + 4));
  expect([text(0), view.getUint32(4, true), text(8), text(12), text(36), view.getUint32(40, true)]).toEqual(["RIFF", 42, "WAVE", "fmt ", "data", 6]);
  expect([view.getUint16(20, true), view.getUint16(22, true), view.getUint32(24, true), view.getUint32(28, true), view.getUint16(34, true)]).toEqual([1, 1, 16_000, 32_000, 16]);
  expect([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true)]).toEqual([1, -2, 300]);
});

test("the STT provider: PCM in chunks of any size (odd bytes too), one speech start, the turn sent as WAV, the words as an utterance", async () => {
  const sent: Uint8Array[] = [], said: string[] = [];
  let starts = 0;
  const ears = new SonaTranscriber(async audio => { sent.push(audio); return { text: "  Bila saya kena makan ubat?  ", source: "model", model: "sona-asr" }; });
  const session = ears.createSession({ onSpeechStart: () => starts++, onUtterance: text => said.push(text) });
  const speech = pcm(quiet(300), tone(900), quiet(900)), raw = bytes(speech);
  for (let at = 0; at < raw.length; at += 333) session.feed(raw.slice(at, at + 333).buffer);
  await Bun.sleep(0);
  expect([starts, said]).toEqual([1, ["Bila saya kena makan ubat?"]]);
  const view = new DataView(sent[0]!.buffer);
  expect([String.fromCharCode(...sent[0]!.subarray(0, 4)), view.getUint32(24, true), view.getUint32(40, true)]).toEqual(["RIFF", 16_000, sent[0]!.length - 44]);
  // The odd byte at each 333-byte seam was carried over: the turn is a sample-exact stretch of what was spoken.
  const samples = new Int16Array(sent[0]!.slice(44).buffer);
  const at = Array.from({ length: speech.length / 320 }, (_, k) => k * 320).find(o => samples.every((s, i) => s === speech[o + i]));
  expect(at).toBeDefined();
});

test("the STT provider: while the ASR starts, the turn is unheard with its minutes; words heard in order; nothing after close", async () => {
  const unheard: (number | undefined)[] = [], said: string[] = [];
  const starting = new SonaTranscriber(async (): Promise<Heard> => ({ text: "", source: "fixture", waking: 30 }), waking => unheard.push(waking));
  const a = starting.createSession({ onUtterance: text => said.push(text) });
  a.feed(bytes(pcm(tone(600), quiet(800))).buffer);
  await Bun.sleep(0);
  expect([unheard, said]).toEqual([[30], []]);

  // The first turn takes longer to read than the second; the agent still hears them in the order they were said.
  let calls = 0;
  const slowFirst = new SonaTranscriber(async () => {
    const n = ++calls;
    await Bun.sleep(n === 1 ? 30 : 1);
    return { text: n === 1 ? "pertama" : "kedua", source: "model", model: "sona-asr" };
  });
  const b = slowFirst.createSession({ onUtterance: text => said.push(text) });
  b.feed(bytes(pcm(tone(600), quiet(800), tone(600), quiet(800))).buffer);
  await Bun.sleep(60);
  expect(said).toEqual(["pertama", "kedua"]);

  // A heard nothing (a sigh) is no turn; a closed session says nothing more.
  const c = new SonaTranscriber(async () => ({ text: " ", source: "model", model: "sona-asr" }), waking => unheard.push(waking)).createSession({ onUtterance: text => said.push(text) });
  c.feed(bytes(pcm(tone(600), quiet(800))).buffer);
  const d = slowFirst.createSession({ onUtterance: text => said.push(text) });
  d.feed(bytes(pcm(tone(600), quiet(800))).buffer);
  d.close();
  await Bun.sleep(40);
  expect([unheard, said]).toEqual([[30], ["pertama", "kedua"]]);
});

test("a turn is read from its first 0.3 s of quiet: said through, it is read once and its words come as it ends; a patient who goes on is read again, whole", async () => {
  const sent: number[] = [], said: string[] = [];
  const ears = new SonaTranscriber(async audio => { sent.push(audio.length); return { text: `turn of ${audio.length} bytes`, source: "model", model: "sona-asr" }; });
  const session = ears.createSession({ onUtterance: text => said.push(text) });
  const feed = (speech: Int16Array) => { const raw = bytes(speech); for (let at = 0; at < raw.length; at += 3200) session.feed(raw.slice(at, at + 3200).buffer); };
  feed(pcm(quiet(300), tone(900), quiet(900)));
  await Bun.sleep(0);
  expect(sent.length).toBe(1); // the early reading is the turn's
  expect(said).toEqual([`turn of ${sent[0]} bytes`]);
  // A pause of 0.5 s mid-turn: read early, in vain; the whole turn is read at its end (its early reading is that of the whole).
  feed(pcm(tone(800), quiet(500), tone(800), quiet(900)));
  await Bun.sleep(0);
  expect(sent.length).toBe(3);
  expect(sent[2]).toBeGreaterThan(sent[1]!);
  expect(said[1]).toBe(`turn of ${sent[2]} bytes`);
});
