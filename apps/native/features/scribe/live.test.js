import { describe, expect, test } from "bun:test";
import { newEncounter } from "@/features/encounter/fixtures";
import { captionLine, captionLines, draftFrom, draftLines, draftOrigin, failedLine, HARD_MS, heardLine,isCaption, isQuiet, listen, mergeVoice, namesOf, nameVoice, placeCaption, ROLES, roleLabel, roleOf, scribeStore, sendPart, speechOff, turnLines, UNSURE, voicesOf, withCapturedDraft, withDraft, withPart } from "./live";

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
    transcribe: async (audio, memory) => { calls.push(memory ? [audio, memory] : audio); const reply = replies.shift(); if (reply instanceof Error) throw reply; return typeof reply === "string" ? { text: reply } : reply; },
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
  test("a part goes with the voice memory of the one before, on the retry too, and brings back the voices and the new memory", async () => {
    const calls = [];
    const segments = [{ voice: 2, from: 0, to: 4, text: "Batuk lima hari." }];
    const heard = await sendPart("4.wav", deps([new Error("offline"), { text: " Batuk lima hari. ", segments, memory: "m4" }], calls, []), undefined, "m3");
    expect(heard).toEqual({ text: "Batuk lima hari.", segments, memory: "m4" });
    expect(calls).toEqual([["b64:4.wav", "m3"], ["b64:4.wav", "m3"]]);
  });
});

describe("who said what", () => {
  const part = n => ({ n, from: (n - 1) * 30, to: n * 30 });
  const seg = (voice, text) => ({ voice, from: 0, to: 1, text });
  const visit = () => [
    ...captionLines(part(1), { text: "", segments: [seg(1, "Okay Amelia, have a seat."), seg(2, " Batuk lima hari doktor, malam lagi teruk. "), seg(1, "Ada kahak?")] }),
    ...captionLines(part(2), { text: "", segments: [seg(3, "Dia demam juga semalam."), seg(2, "Ya.")] }),
  ];

  test("a part's voices become lines in the order they spoke, each under its voice number; the doctor can relabel them", () => {
    const lines = visit().slice(0, 3);
    expect(lines.map(l => [l.id, l.speaker, l.voice, l.original])).toEqual([
      ["part-1-1", "Voice 1", 1, "Okay Amelia, have a seat."], ["part-1-2", "Voice 2", 2, "Batuk lima hari doktor, malam lagi teruk."], ["part-1-3", "Voice 1", 1, "Ada kahak?"],
    ]);
    expect(lines[1].english).toBe(lines[1].original);
    expect(lines.some(isCaption)).toBe(false);
  });
  test("a part whose voices could not be told apart stays one caption under its time", () => {
    for (const heard of [{ text: "Sesak nafas ada tak?" }, { text: "Sesak nafas ada tak?", segments: [] }, { text: "Sesak nafas ada tak?", segments: [seg(1, " ")] }]) {
      const lines = captionLines(part(2), heard);
      expect(lines).toEqual([captionLine(part(2), "Sesak nafas ada tak?")]);
      expect([lines[0].speaker, lines[0].voice, isCaption(lines[0])]).toEqual(["00:30–01:00", undefined, true]);
    }
  });
  test("a retried part's lines go back where they were said, in order, in place of what the part had", () => {
    const two = captionLines(part(2), { text: "", segments: [seg(2, "Sesak sikit."), seg(1, "Sejak bila?")] });
    let transcript = placeCaption(placeCaption([], visit().slice(0, 3)), captionLine(part(3), "Penicillin, dulu kena rash."));
    transcript = placeCaption(transcript, two);
    expect(transcript.map(l => l.id)).toEqual(["part-1-1", "part-1-2", "part-1-3", "part-2-1", "part-2-2", "part-3"]);
    // Heard again with fewer voices, the part's old lines all go.
    expect(placeCaption(transcript, captionLine(part(2), "Sesak sikit. Sejak bila?")).map(l => l.id)).toEqual(["part-1-1", "part-1-2", "part-1-3", "part-2", "part-3"]);
    expect(placeCaption(turnLines([{ text: "Okay Amelia.", speaker: "clinician", sure: true }]), two).map(l => l.id)).toEqual(["turn-1", "part-2-1", "part-2-2"]);
  });
  test("the people heard are listed as they first spoke, each with the longest thing they said; a number or an unsure label is not a name yet", () => {
    const transcript = [captionLine(part(9), "Selamat pagi."), ...visit()]; // a caption under a time is nobody yet
    expect(voicesOf(transcript)).toEqual([
      { voice: 1, label: "Voice 1", named: false, lines: 2, quote: "Okay Amelia, have a seat." },
      { voice: 2, label: "Voice 2", named: false, lines: 2, quote: "Batuk lima hari doktor, malam lagi teruk." },
      { voice: 3, label: "Voice 3", named: false, lines: 1, quote: "Dia demam juga semalam." },
    ]);
    const unsure = transcript.map(l => l.voice === 3 ? { ...l, speaker: `Family${UNSURE}` } : l);
    expect(voicesOf(nameVoice(unsure, 2, "Patient")).map(p => [p.label, p.named])).toEqual([["Voice 1", false], ["Patient", true], ["Family", false]]);
  });
  test("naming a voice relabels every line it said and nothing else; a name loses its unsure mark and its spaces", () => {
    const named = nameVoice(nameVoice(visit(), 2, ` Puan Amelia${UNSURE} `), 1, "Clinician");
    expect(named.map(l => l.speaker)).toEqual(["Clinician", "Puan Amelia", "Clinician", "Voice 3", "Puan Amelia"]);
    expect(named.map(l => [l.id, l.voice, l.original])).toEqual(visit().map(l => [l.id, l.voice, l.original]));
    expect(nameVoice(named, 3, "  ")).toBe(named); // no name given: nothing changes
  });
  test("two voices that were one person are merged under the kept voice's label", () => {
    const merged = mergeVoice(nameVoice(visit(), 2, "Patient"), 3, 2);
    expect(merged.map(l => [l.voice, l.speaker])).toEqual([[1, "Voice 1"], [2, "Patient"], [1, "Voice 1"], [2, "Patient"], [2, "Patient"]]);
    expect(voicesOf(merged).map(p => [p.voice, p.lines])).toEqual([[1, 2], [2, 3]]);
  });
  test("the draft is asked with each line's voice, and a speaker only where a role is settled: not a number, a name, or unsure", () => {
    const transcript = nameVoice(nameVoice(visit(), 1, "Clinician"), 2, "Puan Amelia").map(l => l.voice === 3 ? { ...l, speaker: `Family${UNSURE}` } : l);
    expect(draftLines([...transcript.slice(0, 2), ...transcript.slice(3), { id: "typed", speaker: "Nurse", original: "BP 120/80.", english: "BP 120/80." }])).toEqual([
      { text: "Okay Amelia, have a seat.", speaker: "clinician", voice: 1 }, { text: "Batuk lima hari doktor, malam lagi teruk.", voice: 2 },
      { text: "Dia demam juga semalam.", voice: 3 }, { text: "Ya.", voice: 2 }, { text: "BP 120/80.", speaker: "nurse" },
    ]);
    expect(ROLES.map(roleOf).map(roleLabel)).toEqual([...ROLES]);
    expect([roleOf("Voice 1"), roleOf(`Patient${UNSURE}`), roleOf("patient")]).toEqual([undefined, undefined, undefined]);
  });
  test("a draft keeps the names the doctor gave, marks Gemma's unsure roles, and leaves a voice it could not place under its number", () => {
    const turns = [
      { text: "Ada kahak?", speaker: "patient", voice: 1, sure: true }, { text: "Ada, kuning.", speaker: "patient", voice: 2, sure: true },
      { text: "Dia demam juga.", speaker: "family", voice: 3, sure: false }, { text: "Ya.", voice: 4, sure: false }, { text: "Okay.", sure: false },
    ];
    const names = namesOf(nameVoice(visit(), 1, "Dr Lim"));
    expect([...names]).toEqual([[1, "Dr Lim"]]);
    expect(turnLines(turns, names).map(l => [l.speaker, l.voice])).toEqual([["Dr Lim", 1], ["Patient", 2], ["Family · unsure", 3], ["Voice 4", 4], ["Speaker · unsure", undefined]]);
    const drafted = withDraft({ ...newEncounter(), transcript: nameVoice(visit(), 1, "Dr Lim") }, { sections: { subjective: "", objective: "", assessment: "", plan: "" }, turns, dropped: 0, source: "model", model: "gemma" });
    expect(drafted.transcript.map(l => l.speaker)).toEqual(["Dr Lim", "Patient", "Family · unsure", "Voice 4", "Speaker · unsure"]);
    // A voice named before the next part arrives keeps its name in that part.
    expect(captionLines(part(3), { text: "", segments: [seg(1, "Baik."), seg(5, "Terima kasih.")] }, names).map(l => l.speaker)).toEqual(["Dr Lim", "Voice 5"]);
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

test("the insight line counts voices while recording, then people and the names still open", () => {
  const person = (voice, named) => ({ voice, label: named ? "Patient" : `Voice ${voice}`, named, lines: 1, quote: "" });
  expect(heardLine([], true)).toBeUndefined();
  expect([heardLine([person(1, false)], false), heardLine([person(1, false), person(2, true)], false)].map(l => l.count)).toEqual(["1 voice so far", "2 voices so far"]);
  expect(heardLine([person(1, false)], true)).toEqual({ count: "1 person", names: "1 needs a name", open: 1 });
  expect(heardLine([person(1, false), person(2, false), person(3, true)], true)).toEqual({ count: "3 people", names: "2 need a name", open: 2 });
  expect(heardLine([person(1, true), person(2, true)], true)).toEqual({ count: "2 people", names: "all named", open: 0 });
});
