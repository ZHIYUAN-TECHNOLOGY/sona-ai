import { expect, test } from "bun:test";
import { agentUrl, parse, quiet, reduce, sentencesOf, spanOf } from "./protocol";

const run = (actions, from = quiet) => actions.reduce(reduce, from);
const cut = text => sentencesOf(text).map(s => text.slice(s.start, s.end));
const lit = (text, span) => text.slice(span.start, span.end);

test("the agent is reached at the Agents SDK's default route: wss on a https server, ws on a local one", () => {
  expect(agentUrl("https://sona.example.dev", "user 1")).toBe("wss://sona.example.dev/agents/sona-voice-agent/user%201");
  expect(agentUrl("http://localhost:3000", "u1")).toBe("ws://localhost:3000/agents/sona-voice-agent/u1");
});

test("only the protocol's own events are read; diagnostics, metrics, the agent's own messages and broken frames are skipped", () => {
  expect(parse('{"type":"status","status":"listening"}')).toEqual({ type: "status", status: "listening" });
  expect(parse('{"type":"metrics","llm_ms":1}')).toBeUndefined();
  expect(parse('{"type":"diagnostic","event":"x","timestamp":1}')).toBeUndefined();
  expect(parse("not json")).toBeUndefined();
  expect(parse("null")).toBeUndefined();
});

test("a turn: the patient's words as they speak, Sona's answer as it is written, its audio counted, done when the agent listens again", () => {
  // The agent says idle as the socket opens; that idle, arriving after start_call, must not end the call.
  const calling = run([{ type: "welcome", protocol_version: 1 }, { type: "call" }, { type: "status", status: "idle" }]);
  expect(calling).toMatchObject({ ready: true, call: "starting" });
  const listening = run([{ type: "audio_config", format: "mp3", sampleRate: 24000 }, { type: "status", status: "listening" }], calling);
  expect(listening).toMatchObject({ call: "on", status: "listening", format: "mp3", rate: 24000, done: true });

  const asked = run([
    { type: "transcript_interim", text: "when is my" }, { type: "transcript_interim", text: "" },
    { type: "status", status: "thinking" }, { type: "transcript", role: "user", text: "When is my next visit?" },
  ], listening);
  expect(asked).toMatchObject({ heard: "When is my next visit?", status: "thinking", done: false });

  const answering = run([
    { type: "transcript_start", role: "assistant" }, { type: "transcript_delta", text: "Tuesday 13 Oct. " }, { type: "status", status: "speaking" },
    { type: "audio" }, { type: "transcript_delta", text: "Bring your medicines." }, { type: "transcript_end", text: "Tuesday 13 Oct. Bring your medicines." }, { type: "audio" },
  ], asked);
  expect(answering).toMatchObject({ said: "Tuesday 13 Oct. Bring your medicines.", answer: 1, frames: 2, written: true, done: false });
  expect(run([{ type: "status", status: "listening" }], answering)).toMatchObject({ done: true, frames: 2, call: "on" });
});

test("once Sona is cut off, audio still in flight from that answer is dropped until her next answer", () => {
  const speaking = run([{ type: "call" }, { type: "status", status: "listening" }, { type: "transcript_start", role: "assistant" }, { type: "audio" }]);
  const cut = run([{ type: "barge_in" }, { type: "audio" }, { type: "audio" }], speaking);
  expect(cut).toMatchObject({ muted: true, frames: 1 });
  expect(run([{ type: "status", status: "thinking" }, { type: "transcript_start", role: "assistant" }, { type: "audio" }], cut)).toMatchObject({ muted: false, frames: 1, answer: 2 });
  // The agent cutting her off (it heard the patient first) works the same way.
  expect(run([{ type: "playback_interrupt" }, { type: "audio" }], speaking)).toMatchObject({ muted: true, frames: 1 });
});

test("the agent refusing the call, or ending it, drops it; hanging up ourselves does not count as dropped", () => {
  expect(run([{ type: "call" }, { type: "error", message: "Voice call was rejected" }, { type: "status", status: "idle" }])).toMatchObject({ call: "off", dropped: true, error: "Voice call was rejected" });
  expect(run([{ type: "call" }, { type: "status", status: "listening" }, { type: "status", status: "idle" }])).toMatchObject({ call: "off", dropped: true });
  expect(run([{ type: "call" }, { type: "status", status: "listening" }, { type: "hang_up" }])).toMatchObject({ call: "off", dropped: false });
});

test("sentences are cut where the agent cuts them before speaking each: a stop before a space or new line, 10 characters at least", () => {
  expect(cut("Take Paracetamol 2.5 mg every 6 hours. Come back if the fever returns!")).toEqual(["Take Paracetamol 2.5 mg every 6 hours.", "Come back if the fever returns!"]);
  expect(cut("Yes. Take it after food, with water.")).toEqual(["Yes. Take it after food, with water."]);
  expect(cut("  Your visit is on Tue 13 Oct.\nBring your medicines.  ")).toEqual(["Your visit is on Tue 13 Oct.", "Bring your medicines."]);
  // The agent's chunker only knows . ! and ?, so a Chinese answer is spoken (and lit) as one.
  expect(cut("你的复诊在十月四日。请带上药物清单。")).toEqual(["你的复诊在十月四日。请带上药物清单。"]);
  expect(cut("")).toEqual([]);
});

test("each audio frame lights its sentence; the answer's last frame lights the rest, so one frame for a whole answer lights all of it", () => {
  const text = "Take it after food. Come back if the fever returns.";
  expect(lit(text, spanOf(text, 0, 2, false))).toBe("Take it after food.");
  expect(lit(text, spanOf(text, 1, 2, true))).toBe("Come back if the fever returns.");
  expect(lit(text, spanOf(text, 0, 1, false))).toBe("Take it after food.");
  expect(lit(text, spanOf(text, 0, 1, true))).toBe(text);
  // More frames than sentences (a streaming voice): nothing left to light, so the words stay lit rather than going back.
  expect(spanOf(text, 5, 6, false)).toEqual({ start: text.length, end: text.length });
});
