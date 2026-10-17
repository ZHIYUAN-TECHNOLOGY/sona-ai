import { expect, mock, test } from "bun:test";

// The phone, faked: an audio clock the test moves, an MP3 frame that is one float (its length in seconds), and the
// socket and the mic for the test to drive.
const clock = { now: 0 };
let played = [], socket, mic;
mock.module("react-native", () => ({ Platform: { OS: "ios" }, TurboModuleRegistry: { get: () => ({}) } }));
mock.module("react-native-audio-api", () => ({
  AudioContext: class {
    destination = {};
    get currentTime() { return clock.now; }
    async resume() {}
    async close() {}
    async decodeAudioData(data) { return { duration: new Float32Array(data)[0] }; }
    createBufferSource() { const s = { connect() {}, start(at) { s.at = at; played.push(s); }, stop() {} }; return s; }
  },
  AudioManager: { setAudioSessionOptions() {}, setAudioSessionActivity: async () => {}, requestRecordingPermissions: async () => "Granted" },
  AudioRecorder: class { onAudioReady(_, listen) { mic = listen; } clearOnAudioReady() {} async start() { return { status: "success" }; } async stop() {} },
}));
globalThis.WebSocket = class { static OPEN = 1; readyState = 1; sent = []; constructor() { socket = this; } send(m) { this.sent.push(m); } close() {} };
const { connectLive } = await import("./session");

const agent = m => socket.onmessage({ data: m instanceof ArrayBuffer ? m : JSON.stringify(m) });
const mp3 = seconds => new Float32Array([seconds]).buffer;
const heard = () => played.map(s => [s.buffer.duration, s.at]);
/** 100 ms of mic at this loudness. */
const speak = level => mic({ buffer: { sampleRate: 16_000, getChannelData: () => new Float32Array(1600).fill(level) } });

/** A call in Sona's own voice, her answer started; the phone's voice reads when asked until `finish` (or a hush). */
async function call() {
  clock.now = 0;
  played = [];
  const phone = { reads: [], hushed: 0, finish: () => {} };
  const live = connectLive("wss://sona.test/agents/sona-voice-agent/u1", undefined, {
    change() {}, tick() {}, closed() {}, plays: () => true,
    hush: () => { phone.hushed++; phone.finish(); },
    read: (text, k) => new Promise(done => { phone.reads.push([text, k, clock.now]); phone.finish = done; }),
  });
  agent({ type: "welcome", protocol_version: 1 });
  expect(await live.start()).toBe("ok");
  agent({ type: "audio_config", format: "mp3", sampleRate: 16000 });
  agent({ type: "status", status: "listening" });
  agent({ type: "transcript_start", role: "assistant" });
  agent({ type: "transcript_delta", text: "Rest at home today." });
  return { live, phone };
}

test("a sentence her voice sent without audio is read by the phone in its place: after her audio before it, and her next waits for it", async () => {
  const { live, phone } = await call();
  agent(mp3(2));
  agent({ type: "transcript_delta", text: " Drink plenty of water." });
  agent({ type: "sona_say", text: "Drink plenty of water.", reason: "slow" });
  agent({ type: "transcript_delta", text: " Come back if the fever returns." });
  agent(mp3(3));
  await Bun.sleep(80);
  expect([heard(), phone.reads]).toEqual([[[2, 0]], []]); // her first sentence is still playing
  clock.now = 2.05;
  await Bun.sleep(80);
  expect(phone.reads).toEqual([["Drink plenty of water.", 1, 2.05]]);
  expect([heard(), live.audible()]).toEqual([[[2, 0]], true]); // her next waits, and the phone is her for the gate
  clock.now = 4;
  phone.finish();
  await Bun.sleep(10);
  expect([heard(), live.playing()]).toEqual([[[2, 0], [3, 4]], { frame: 2, share: 0 }]); // her third sentence, lit as such
});

test("while the phone reads in her place the agent hears silence, and talking over it stops the phone and what was to follow", async () => {
  const { live, phone } = await call();
  agent(mp3(1));
  agent({ type: "sona_say", text: "Drink plenty of water.", reason: "slow" });
  agent(mp3(3));
  await Bun.sleep(10);
  clock.now = 1.05;
  await Bun.sleep(80);
  expect(phone.reads).toHaveLength(1);
  const from = socket.sent.length;
  for (let i = 0; i < 4; i++) speak(0.02); // the phone's voice coming back through the mic
  expect(socket.sent.slice(from).every(f => f instanceof ArrayBuffer && new Int16Array(f).every(s => s === 0))).toBe(true);
  speak(0.4);
  speak(0.4); // the patient talks over her
  await Bun.sleep(10);
  expect([phone.hushed, heard(), live.audible(), socket.sent.includes('{"type":"interrupt"}')]).toEqual([1, [[1, 0]], false, true]);
});

test("a sentence without audio before any of hers is left to the phone's reading of the whole answer", async () => {
  const { phone } = await call();
  agent({ type: "sona_say", text: "Rest at home today.", reason: "slow" });
  await Bun.sleep(80);
  expect(phone.reads).toEqual([]);
});
