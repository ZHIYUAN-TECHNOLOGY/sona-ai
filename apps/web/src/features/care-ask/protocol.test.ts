// @ts-expect-error apps/web has no bun types yet (no new dependencies in this change); add @types/bun and drop this line.
import { expect, test } from "bun:test";

import { agentUrl, gate, hello, parse, quiet, reduce, step, toPcm16 } from "./protocol";

test("the call's wire format: encode, decode, captions, mic PCM and the gate", () => {
  expect(JSON.parse(hello)).toEqual({ type: "hello", protocol_version: 1 });
  expect(agentUrl("https://sona.example", "u 1", "ms")).toBe("wss://sona.example/agents/sona-voice-agent/u%201?lang=ms");
  expect(parse("not json")).toBeUndefined();
  expect(parse('{"type":"metrics"}')).toBeUndefined();

  let t = quiet;
  for (const frame of ['{"type":"status","status":"listening"}', '{"type":"transcript_interim","text":"when is"}', '{"type":"transcript","role":"user","text":"When is my visit?"}', '{"type":"status","status":"thinking"}', '{"type":"transcript_start","role":"assistant"}', '{"type":"transcript_delta","text":"On "}', '{"type":"transcript_delta","text":"Friday."}', '{"type":"playback_interrupt"}']) t = reduce(t, parse(frame)!);
  expect(t).toEqual({ status: "thinking", heard: "When is my visit?", said: "On Friday.", muted: true });
  expect(reduce(t, { type: "status", status: "thinking" }).muted).toBe(false);

  expect([...new Int16Array(toPcm16(new Float32Array([0, 1, -1, 2])))]).toEqual([0, 32767, -32768, 32767]);

  // Speech starts, Sona is talked over after 200 ms, then 500 ms of quiet ends the speech.
  let g = gate();
  const a = step(g, 0.2, 100, true);
  expect(a.mark).toBe("start_of_speech");
  expect(a.interrupt).toBe(false);
  const b = step(a.gate, 0.2, 100, true);
  expect(b.interrupt).toBe(true);
  g = b.gate;
  let mark: string | undefined;
  for (let i = 0; i < 5; i++) ({ gate: g, mark } = step(g, 0, 100, false));
  expect(mark).toBe("end_of_speech");
});

test("a call answer's sona_turn brings its 999 flag and coloured words, until the next answer starts", () => {
  const said = reduce(quiet, parse('{"type":"transcript_end","text":"Chest pain needs care now."}')!);
  const turn = reduce(said, parse('{"type":"sona_turn","grounded":false,"urgent":true,"source":"model","marks":[{"text":"Chest pain","kind":"alert"},{"text":"x","kind":"sparkle"}]}')!);
  expect(turn).toMatchObject({ said: "Chest pain needs care now.", urgent: true, marks: [{ text: "Chest pain", kind: "warning" }] });
  // An older agent's sona_turn has no marks: the word lists colour, as before.
  expect(reduce(said, parse('{"type":"sona_turn","grounded":true,"urgent":false}')!)).toMatchObject({ urgent: false, marks: undefined });
  expect(reduce(turn, { type: "transcript_start", role: "assistant" })).toMatchObject({ said: "", urgent: undefined, marks: undefined });
});
