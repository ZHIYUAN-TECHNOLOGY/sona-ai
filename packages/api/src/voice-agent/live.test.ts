import { expect, test } from "bun:test";

import { answerTurn, type ChatMessage, type ChatStream } from "./answer";
import { CallHistory, Checks, LiveTurns, Says, liveBrief, liveStart, mayReport, type PhoneEvent } from "./live";

const listen = { listen: true, text: "", end_of_turn: false };
const speak = (text: string, end_of_turn = false) => ({ listen: false, text, end_of_turn });

test("box ④'s seconds become one answer on the phone: opened on the first spoken second, closed at her end of turn", () => {
  const turns = new LiveTurns();
  expect(turns.unit(listen)).toEqual([]);
  expect(turns.unit(speak(" Take it after"))).toEqual([
    { type: "transcript_start", role: "assistant" }, { type: "status", status: "speaking" }, { type: "transcript_delta", text: " Take it after" },
  ]);
  expect(turns.unit(speak(" food."))).toEqual([{ type: "transcript_delta", text: " food." }]);
  expect(turns.unit(speak("", true))).toEqual([{ type: "transcript_end", text: "Take it after food." }, { type: "status", status: "listening" }]);
  expect(turns.unit(listen)).toEqual([]);
  expect(turns.unit(speak(" Ya."))[0]).toEqual({ type: "transcript_start", role: "assistant" });
  expect(turns.said).toEqual(["Take it after food."]);
});

test("the 999 floor sees 999 in an answer since the emergency was heard, finished or still being spoken", () => {
  const turns = new LiveTurns();
  turns.unit(speak(" Take it after food.", true));
  const from = turns.said.length;
  expect(turns.sent999(from)).toBe(false);
  turns.unit(speak(" Call 999"));
  expect(turns.sent999(from)).toBe(true);
  expect(turns.sent999(turns.said.length)).toBe(true);
  turns.unit(speak(" now.", true));
  expect(turns.sent999(from)).toBe(true);
  expect(turns.sent999(turns.said.length)).toBe(false);
});

test("the brief is the one stage 1 learnt, in the patient's language, with their plan or none yet", () => {
  expect(liveBrief("Medicines:\n- Amoxicillin 500mg", "ms")).toEndWith("answer in Malay.\n\nDischarge plan:\nMedicines:\n- Amoxicillin 500mg");
  expect(liveBrief(undefined, "en")).toEndWith("Discharge plan:\nNone yet: they are still in hospital.");
  expect(liveBrief(undefined, "en")).not.toContain("JSON");
});

test("only words that may report feeling worse go on to the care team's reader", () => {
  expect(mayReport("Demam saya datang balik")).toBe(true);
  expect(mayReport("When is my next appointment?")).toBe(false);
});

test("a check fires once a turn, whichever ear hears it first and however late the other comes", () => {
  const checks = new Checks();
  expect(checks.take("report", "box4", "Doktor saya patuk sampai tidur tak boleh, still demam.", 1000)).toBe(true);
  // Box ② wakes 40 s later with the same turn, spelt its own way: no second task.
  expect(checks.take("report", "box2", "Doktor, saya batuk sampai tak boleh tidur. Still demam.", 41_000)).toBe(false);
  // A different symptom straight after fires, from either ear, once.
  expect(checks.take("report", "box4", "My chest pain is getting worse.", 43_000)).toBe(true);
  expect(checks.take("report", "box2", "My chest pain is getting worse", 44_000)).toBe(false);
  // The other check keeps its own turns, and the same words said again later are a new turn.
  expect(checks.take("call999", "box2", "My chest pain is getting worse", 44_000)).toBe(true);
  expect(checks.take("report", "box4", "My chest pain is getting worse.", 90_000)).toBe(true);
});

test("999 said in words counts as sending them to 999", () => {
  const turns = new LiveTurns();
  turns.unit(speak(" Call nine nine nine now.", true));
  expect(turns.sent999(0)).toBe(true);
});

// The hybrid call (SONA_LIVE_BRAIN=gemma): Gemma writes, box ④ says.
const end = speak("", true);
/** A Says, the says it sent to the box, and what the phone was shown of the box's seconds (through LiveTurns, as the agent does). */
function hybrid() {
  const sent: string[] = [], turns = new LiveTurns(), shown: PhoneEvent[] = [];
  const says = new Says(say => sent.push(say.text));
  const show = (u?: ReturnType<Says["unit"]>) => { if (u) shown.push(...turns.unit(u)); };
  return { says, sent, turns, shown, show, box: (u: Parameters<Says["unit"]>[0]) => show(says.unit(u)) };
}

test("the start message holds her to listening only with Gemma as the brain; her own brain's start is as it was", () => {
  expect(liveStart("brief", "own", true)).toEqual({ type: "start", system: "brief", voice: "v1", transcribe: true });
  expect(liveStart("brief", "own", false)).toEqual({ type: "start", system: "brief", voice: "v1", transcribe: false });
  expect(liveStart("brief", "gemma", true)).toEqual({ type: "start", system: "brief", voice: "v1", transcribe: false, hold: true });
});

test("the first sentence goes to the box at once; those written while she says it go together at her end of turn, in order, as one answer", () => {
  const { says, sent, turns, shown, show, box } = hybrid();
  show(says.begin());
  says.sentence("Take it after food.");
  expect(sent).toEqual(["Take it after food."]);
  says.sentence("Twice a day.");
  says.sentence("Drink water with it.");
  expect(sent).toHaveLength(1); // one say is with the box at a time: another would replace it
  box(listen);
  box(speak("Take it after"));
  box(speak(" food."));
  box(end);
  expect(sent).toEqual(["Take it after food.", "Twice a day. Drink water with it."]);
  show(says.end()); // Gemma finished while she is still speaking: the answer stays open
  box(speak("Twice a day."));
  box(speak(" Drink water with it."));
  expect(turns.said).toEqual([]);
  box(end);
  expect(turns.said).toEqual(["Take it after food. Twice a day. Drink water with it."]);
  expect(shown.filter(e => e.type === "transcript_start" || e.type === "transcript_end")).toEqual([
    { type: "transcript_start", role: "assistant" }, { type: "transcript_end", text: "Take it after food. Twice a day. Drink water with it." },
  ]);
});

test("an answer she finishes saying before Gemma finishes writing stays open, and closes when Gemma does", () => {
  const { says, sent, turns, show, box } = hybrid();
  show(says.begin());
  says.sentence("Rest today.");
  box(speak("Rest today."));
  box(end);
  expect(turns.said).toEqual([]);
  says.sentence("I've let your care team know."); // nothing is with the box, so it goes at once
  expect(sent).toEqual(["Rest today.", "I've let your care team know."]);
  box(speak("I've let your care team know."));
  box(end);
  expect(turns.said).toEqual([]);
  show(says.end());
  expect(turns.said).toEqual(["Rest today. I've let your care team know."]);
});

test("Chinese sentences go and show with no space between them", () => {
  const { says, sent, turns, show, box } = hybrid();
  show(says.begin());
  says.sentence("饭后服用。");
  says.sentence("一天两次。");
  says.sentence("多喝水。");
  box(speak("饭后服用。"));
  box(end);
  expect(sent).toEqual(["饭后服用。", "一天两次。多喝水。"]);
  show(says.end());
  box(speak("一天两次。多喝水。"));
  box(end);
  expect(turns.said).toEqual(["饭后服用。一天两次。多喝水。"]);
});

test("cut off, the rest of the answer is dropped and she is stopped; the new turn's answer waits for her to stop, then is its own answer", () => {
  const { says, sent, turns, shown, show, box } = hybrid();
  show(says.begin());
  says.sentence("Take it after food.");
  says.sentence("Twice a day.");
  box(speak("Take it"));
  show(says.stop()); // the patient spoke over her
  expect(sent).toEqual(["Take it after food.", ""]); // the empty say replaces her script
  show(says.begin()); // the new turn
  says.sentence("Yes, with water.");
  expect(sent).toHaveLength(2);
  box(speak(" after")); // the second she was already in: not shown
  box(end);
  expect(turns.said).toEqual(["Take it"]);
  expect(sent).toEqual(["Take it after food.", "", "Yes, with water."]); // "Twice a day." never goes
  box(speak("Yes, with water."));
  show(says.end());
  box(end);
  expect(turns.said).toEqual(["Take it", "Yes, with water."]);
  expect(shown.filter(e => e.type === "transcript_start")).toHaveLength(2);
});

test("a cut that crosses her own end of turn: the empty turn the box then says is not taken for the next say's end", () => {
  const { says, sent, turns, show, box } = hybrid();
  show(says.begin());
  says.sentence("Take it after food.");
  box(speak("Take it after food."));
  show(says.stop());
  show(says.begin());
  says.sentence("Yes, with water.");
  box(end); // her own end, already on its way when the cut was sent
  expect(sent).toEqual(["Take it after food.", "", "Yes, with water."]);
  says.sentence("A full glass.");
  box(end); // the cut, said as a turn of its own: no words of the new say have come back yet
  expect(sent).toHaveLength(3);
  expect(turns.said).toEqual(["Take it after food."]);
  box(speak("Yes, with water."));
  box(end);
  expect(sent[3]).toBe("A full glass.");
});

test("cut off between says there is nothing to stop: the answer closes at once", () => {
  const { says, sent, turns, show, box } = hybrid();
  show(says.begin());
  says.sentence("Rest today.");
  box(speak("Rest today."));
  box(end);
  show(says.stop());
  expect(sent).toEqual(["Rest today."]);
  expect(turns.said).toEqual(["Rest today."]);
  box(end); // nothing of ours is with the box
  expect(turns.said).toHaveLength(1);
});

test("Gemma reads the call so far on each turn: every patient turn, and each answer as it was written, cut off or not", async () => {
  const call = new CallHistory(), asked: ChatMessage[][] = [];
  const replies = ['{"triage":"fine","inPlan":true}\nTake it after food. Twice a day.', '{"triage":"fine","inPlan":true}\nYes, with water.', '{"triage":"fine","inPlan":false}\nGoodbye for now.'];
  const chat: ChatStream = async messages => {
    asked.push(messages);
    const reply = replies[asked.length - 1]!;
    return { text: (async function* () { yield reply; })(), model: "gemma" };
  };
  async function turn(question: string, stopAfter = Infinity) {
    const { history, said } = call.turn(question), stop = new AbortController(), sentences: string[] = [];
    for await (const part of answerTurn({ question, history, chat, language: "en", signal: stop.signal, escalate: async () => false })) {
      if (stop.signal.aborted) break; // as the agent leaves an answer that was cut off
      if (part.type !== "text-delta") continue;
      said(part.text);
      if (sentences.push(part.text) === stopAfter) stop.abort();
    }
    return sentences;
  }
  expect(await turn("How do I take it?", 1)).toEqual(["Take it after food."]); // the patient cut in after the first sentence
  expect(await turn("With water?")).toEqual(["Yes, with water."]);
  await turn("Thanks, bye.");
  expect(asked[1]!.slice(1)).toEqual([
    { role: "user", content: "How do I take it?" }, { role: "assistant", content: "Take it after food." }, { role: "user", content: "With water?" },
  ]);
  expect(asked[2]!.slice(1).map(m => m.content)).toEqual(["How do I take it?", "Take it after food.", "With water?", "Yes, with water.", "Thanks, bye."]);
});

test("a turn cut off before any answer leaves two patient lines for Gemma, not an empty answer", () => {
  const call = new CallHistory();
  call.turn("How do I");
  expect(call.turn("How do I take it?").history).toEqual([{ role: "user", content: "How do I" }]);
});
