import { describe, expect, test } from "bun:test";
import { newEncounter } from "@/features/encounter/fixtures";
import { captionLine, draftFrom, draftLines, draftOrigin, failedLine, HARD_MS, isQuiet, listen, placeCaption, scribeStore, sendPart, speechOff, turnLines, withCapturedDraft, withDraft, withPart } from "./live";

/**
 * Plays a recording through `listen` as the recorder does, ten level readings a second: speech around -30 dBFS, and
 * -62 inside `pauses` ([from, to) seconds). Returns the seconds at which a part was cut.
 */
function cutsOf(seconds, pauses) {
  const cuts = [];
  let heard = { levels: [] }, partFrom = 0;
  for (let tenth = 0; tenth <= seconds * 10; tenth++) {
    const t = tenth / 10;
    const level = pauses.some(([from, to]) => t >= from && t < to) ? -62 : -30 + 4 * Math.sin(tenth);
    const reading = listen(heard, { elapsed: (t - partFrom) * 1000, level, now: t * 1000 });
    heard = reading.heard;
    if (reading.cut) { cuts.push(t); partFrom = t; heard = { levels: [] }; }
  }
  return cuts;
}

describe("cutting the recording into parts", () => {
  test("a part ends at the first pause after 25 s, never mid-word, and a pause before 25 s is kept inside it", () => {
    expect(cutsOf(90, [[12, 12.6], [27, 27.5], [40, 41], [58, 58.4]])).toEqual([27.3, 58.3]);
  });
  test("with no pause at all, a part still ends by 36 s, inside voice.transcribe's 40 s", () => {
    expect(cutsOf(80, [])).toEqual([36, 72]);
    expect(HARD_MS).toBeLessThan(40_000);
  });
  test("a breath shorter than 0.3 s is not a pause", () => {
    expect(cutsOf(40, [[26, 26.2], [30, 30.25]])).toEqual([36]);
  });
  test("quiet is relative to the room: soft speech in a quiet room is not a pause, a noisy clinic still has them", () => {
    expect(isQuiet(-50, -58)).toBe(true);
    expect(isQuiet(-45, -58)).toBe(false);
    expect(isQuiet(-40, -44)).toBe(true);
    expect(isQuiet(-36, -44)).toBe(false); // never above the dock's speech level
    expect(listen({ levels: [] }, { elapsed: 30_000, level: -160, now: 0 }).heard.quietSince).toBe(0); // not metering yet counts as quiet
  });
});

describe("sending a part", () => {
  const deps = (replies, calls, removed) => ({
    read: async uri => `b64:${uri}`,
    transcribe: async audio => { calls.push(audio); const reply = replies.shift(); if (reply instanceof Error) throw reply; return reply; },
    remove: uri => removed.push(uri),
    wait: async () => {},
  });
  test("each part is sent once and retried once on failure; its audio is deleted only once heard", async () => {
    const calls = [], removed = [];
    let retries = 0;
    expect(await sendPart("1.wav", deps([" Batuk lima hari. "], calls, removed))).toEqual({ text: "Batuk lima hari." });
    expect(await sendPart("2.wav", deps([new Error("offline"), "Demam semalam."], calls, removed), () => retries++)).toEqual({ text: "Demam semalam." });
    const down = new Error("down");
    expect(await sendPart("3.wav", deps([down, down], calls, removed), () => retries++)).toEqual({ error: down });
    expect(calls).toEqual(["b64:1.wav", "b64:2.wav", "b64:2.wav", "b64:3.wav", "b64:3.wav"]);
    expect(retries).toBe(2);
    expect(removed).toEqual(["1.wav", "2.wav"]); // 3.wav stays on the phone for the clinician's retry
  });
  test("silence is heard as no words, and its audio is deleted too", async () => {
    const removed = [];
    expect(await sendPart("quiet.wav", deps([""], [], removed))).toEqual({ text: "" });
    expect(removed).toEqual(["quiet.wav"]);
  });
});

test("the speech model's refusal says whether it is starting, and for how long when the server knows", () => {
  const off = message => ({ message, data: { code: "SPEECH_OFF" } });
  expect(speechOff(off("The speech model is starting (about 30 min). Try again then, or type."))).toEqual({ starting: true, minutes: 30 });
  expect(speechOff(off("The speech model is starting. Try again in a minute, or type."))).toEqual({ starting: true, minutes: undefined });
  expect(speechOff(off("Speaking to Sona isn't switched on yet. Type instead."))).toEqual({ starting: false, minutes: undefined });
  expect(speechOff(new Error("Failed to fetch"))).toBeUndefined();
});

test("captions keep recording order: a part that failed and was retried goes back where it was said; after a draft, it follows the turns", () => {
  const part = n => ({ n, from: (n - 1) * 30, to: n * 30 });
  let transcript = placeCaption([], captionLine(part(1), "Okay Amelia, have a seat."));
  transcript = placeCaption(transcript, captionLine(part(3), "Penicillin, dulu kena rash."));
  transcript = placeCaption(transcript, captionLine(part(2), "Sesak nafas ada tak?"));
  expect(transcript.map(l => [l.id, l.speaker])).toEqual([["part-1", "00:00–00:30"], ["part-2", "00:30–01:00"], ["part-3", "01:00–01:30"]]);
  const turns = turnLines([{ text: "Okay Amelia.", speaker: "clinician", sure: true }]);
  expect(placeCaption(turns, captionLine(part(4), "Okay doktor.")).map(l => l.id)).toEqual(["turn-1", "part-4"]);
});

test("one failed part is named by its time; the others carry on", () => {
  let parts = [{ n: 1, from: 0, to: 30, status: "done" }, { n: 2, from: 30, to: 61, status: "sending" }, { n: 3, from: 61, to: 90, status: "done" }];
  parts = withPart(2, { status: "failed", error: "The server did not answer" })({ parts }).parts;
  expect(parts.map(p => p.status)).toEqual(["done", "failed", "done"]);
  expect(failedLine(parts.filter(p => p.status === "failed"))).toBe("Part 2 (00:30–01:01) wasn't transcribed.");
  expect(failedLine([parts[1], { ...parts[2], n: 3 }])).toBe("2 parts weren't transcribed: 00:30–01:01, 01:01–01:30.");
});

test("the draft's turns mark who said what, unsure ones marked; only a settled speaker goes back to the server", () => {
  const lines = turnLines([
    { text: "Ada kahak?", speaker: "clinician", sure: true },
    { text: "Ada, kuning.", speaker: "patient", sure: false },
    { text: "Okay.", sure: false },
  ]);
  expect(lines.map(l => l.speaker)).toEqual(["Clinician", "Patient · unsure", "Speaker · unsure"]);
  const captions = [captionLine({ n: 1, from: 0, to: 30 }, "Batuk lima hari.")];
  expect(draftLines([...captions, ...lines, { ...lines[1], id: "fixed", speaker: "Patient" }])).toEqual([
    { text: "Batuk lima hari." }, { text: "Ada kahak?", speaker: "clinician" }, { text: "Ada, kuning." }, { text: "Okay." }, { text: "Ada, kuning.", speaker: "patient" },
  ]);
});

test("Gemma's draft becomes the note under review and its turns the transcript; a sample keeps the captions; no draft keeps the words", () => {
  const captions = [captionLine({ n: 1, from: 0, to: 30 }, "Batuk lima hari doktor.")];
  const visit = { ...newEncounter(), transcript: captions, noteReviewed: true };
  const sections = { subjective: "Cough for 5 days.", objective: "", assessment: "", plan: "" };
  const turns = [{ text: "Batuk lima hari doktor.", speaker: "patient", sure: true }];
  const fromGemma = withDraft(visit, { sections, turns, dropped: 1, source: "model", model: "gemma-4-26b-a4b" });
  expect(fromGemma.noteSectionDraft).toEqual(sections);
  expect([fromGemma.noteReviewed, fromGemma.noteFromSample, fromGemma.noteSaveStatus]).toEqual([false, false, "idle"]);
  expect(fromGemma.transcript.map(l => [l.speaker, l.original])).toEqual([["Patient", "Batuk lima hari doktor."]]);
  expect(draftOrigin({ sections, turns, dropped: 1, source: "model", model: "gemma-4-26b-a4b" })).toEqual({ source: "model", dropped: 1, model: "gemma-4-26b-a4b" });
  const sample = { sections: { ...sections, subjective: "Batuk lima hari doktor." }, turns: [{ text: "Batuk lima hari doktor.", sure: false }], dropped: 0, source: "fixture", waking: 12 };
  expect(withDraft(visit, sample).transcript).toBe(captions);
  expect(draftOrigin(sample)).toEqual({ source: "fixture", dropped: 0, waking: 12 });
  expect(withCapturedDraft(visit).noteSectionDraft.subjective).toBe("00:00–00:30: Batuk lima hari doktor.");
});

test("the store shares each visit's parts with every screen and tells them when something changes", () => {
  let told = 0;
  const stop = scribeStore.subscribe(() => told++);
  expect(scribeStore.get("SYN-T")).toBe(scribeStore.get(undefined)); // nothing yet: the same empty state, so screens don't re-render
  scribeStore.update("SYN-T", s => ({ ...s, parts: [{ n: 1, from: 0, to: 30, status: "sending" }] }));
  scribeStore.update("SYN-T", withPart(1, { status: "done" }));
  expect(scribeStore.get("SYN-T").parts[0].status).toBe("done");
  expect(told).toBe(2);
  stop();
});

test("the judge build drafts only from a recording: with nothing recorded there is nothing to draft, never the script", () => {
  expect([draftFrom(true, true, 0), draftFrom(true, false, 0), draftFrom(true, false, 3)]).toEqual(["nothing", "nothing", "nothing"]);
  expect(draftFrom(true, true, 3)).toBe("recording");
  // Outside the judge build nothing changes: connected with a transcript asks the server, anything else drafts on the phone.
  expect([draftFrom(false, true, 3), draftFrom(false, true, 0), draftFrom(false, false, 0), draftFrom(false, false, 3)]).toEqual(["recording", "demo", "demo", "demo"]);
});
