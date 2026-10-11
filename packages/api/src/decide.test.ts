import { expect, test } from "bun:test";

import { CLEF_MODEL, clefOf, decideTurn, emergencyOf, laneOf } from "./decide";
import { TRIAL, clefReplay, replay } from "./fixtures/clef-trial";
import type { WorkersAi } from "./workers-models";

test("Clef is asked the trial's question with the words and one fixed line, nothing from a record, and its read comes back by option", async () => {
  const { ai, calls } = clefReplay(replay("c015", "p013"));
  expect(await decideTurn(ai, { app: "care", said: TRIAL.c015.said })).toEqual({
    intent: "emergency", confidence: 0.764, emergency: 0.8919, asksQuestion: false, cancels: false, picks: {},
    probabilities: { medical_question: 0.0338, book_appointment: 0.0191, log_dose: 0.0119, log_reading: 0.0154, next_appointment: 0.0157, emergency: 0.8919, other: 0.0122 },
  });
  expect(calls[0]!.model).toBe(CLEF_MODEL);
  const { model, state, questions } = calls[0]!.input;
  expect(model).toBe("clef-omni");
  expect(state).toEqual({ patient: "A patient of this hospital, writing or speaking to its Sona Care app.", said: TRIAL.c015.said });
  expect(questions.intent.instructions).toBe("What does the patient want from this spoken message?");
  expect(Object.keys(questions.intent.criteria)).toEqual(["medical_question", "book_appointment", "log_dose", "log_reading", "next_appointment", "emergency", "other"]);
  expect([questions.asks_question.type, questions.cancels.type, questions.reading.type]).toEqual(["noul", "noul", "choice"]);
  // Sona Pro asks its own intents, who a task is for and when, and says whether a visit is open; it has no emergency.
  const pro = await decideTurn(ai, { app: "pro", said: TRIAL.p013.said, open: true });
  expect(pro).toMatchObject({ intent: "create_task", confidence: 0.8486, emergency: 0 });
  expect(calls[1]!.input.state.context).toBe("A doctor on a ward round, speaking to Sona Pro. A patient's visit is open on screen.");
  expect(Object.keys(calls[1]!.input.questions)).toEqual(["intent", "asks_question", "cancels", "owner", "due"]);
  // Probabilities stored as a list in the criteria's order (as the trial kept them) read the same.
  const listed: WorkersAi = { run: async () => ({ answers: { intent: { choice: "emergency", confidence: 0.764, probabilities: TRIAL.c015.p }, asks_question: { noul: 0.1 }, cancels: { noul: 0.1 } } }) };
  expect((await decideTurn(listed, { app: "care", said: "x" }))?.emergency).toBe(0.8919);
});

test("the lane takes only its own intents, read surely, with no question besides, nothing called off and no emergency", async () => {
  const { ai } = clefReplay({
    ...replay("c001", "c004", "c015", "c021", "c026", "c035", "c049", "c053", "c054", "p005", "p013", "p026", "p030"),
    "book me in please, and is my cough normal?": { ...TRIAL.c021, asks: 0.8 },
    "book me in next week, no wait": { ...TRIAL.c021 },
    "please put it off": { ...TRIAL.c021, cancels: 0.7 },
  });
  const lane = async (app: "care" | "pro", said: string, urgent = false) => laneOf(await decideTurn(ai, { app, said }), app, said, urgent)?.intent;
  expect(await lane("care", TRIAL.c021.said)).toBe("book_appointment");
  expect(await lane("care", TRIAL.c035.said)).toBe("next_appointment");
  expect(await lane("care", TRIAL.c053.said)).toBe("log_dose");
  expect(await lane("pro", TRIAL.p013.said)).toBe("create_task");
  expect(await lane("pro", TRIAL.p026.said)).toBe("ward_overview");
  // Below LANE_AT (0.606, 0.1767, 0.2029), a medical question or an emergency: Gemma answers.
  for (const id of ["c026", "c001", "c004", "c015", "c049", "c054"] as const) expect(await lane("care", TRIAL[id].said)).toBeUndefined();
  for (const id of ["p005", "p030"] as const) expect(await lane("pro", TRIAL[id].said)).toBeUndefined();
  // A question besides, something called off (Clef's yes, or the words), or the 999 words.
  expect(await lane("care", "book me in please, and is my cough normal?")).toBeUndefined();
  expect(await lane("care", "book me in next week, no wait")).toBeUndefined();
  expect(await lane("care", "please put it off")).toBeUndefined();
  expect(await lane("care", TRIAL.c021.said, true)).toBeUndefined();
  // A Care intent is never Sona Pro's lane, nor the reverse.
  expect(laneOf(await decideTurn(ai, { app: "care", said: TRIAL.c021.said }), "pro", TRIAL.c021.said)).toBeUndefined();
});

test("an emergency at 0.25 or more, as the trial set it: all its emergencies, none of its other questions", async () => {
  const { ai } = clefReplay(replay("c015", "c049", "c054", "c004", "c021"));
  expect(await emergencyOf(ai, TRIAL.c015.said)).toBe(true);
  // Clef chose "other" (0.33), but the emergency was 0.2676: a confused father is an emergency.
  expect(await emergencyOf(ai, TRIAL.c049.said)).toBe(true);
  // Its highest non-emergency (insulin taken, 0.2233) and past chest pain (0.0601) are not.
  expect(await emergencyOf(ai, TRIAL.c054.said)).toBe(false);
  expect(await emergencyOf(ai, TRIAL.c004.said)).toBe(false);
  expect(await emergencyOf(ai, TRIAL.c021.said)).toBe(false);
  expect(await emergencyOf(undefined, TRIAL.c015.said)).toBe(false);
});

test("off, failing, slow or out of shape, Clef is no read, and nothing waits longer than its limit", async () => {
  const { ai, calls } = clefReplay(replay("c015"));
  // CLEF_LANE "1" turns it on; anything else is off, and then Clef is never called.
  expect(clefOf({ CLEF_LANE: "1", AI: ai })).toBe(ai);
  expect(clefOf({ CLEF_LANE: "", AI: ai })).toBeUndefined();
  expect(clefOf({ AI: ai })).toBeUndefined();
  expect(await decideTurn(clefOf({ CLEF_LANE: "0", AI: ai }), { app: "care", said: TRIAL.c015.said })).toBeUndefined();
  expect(calls).toHaveLength(0);

  const failing: WorkersAi = { run: async () => { throw new Error("down"); } };
  expect(await decideTurn(failing, { app: "care", said: "hi" })).toBeUndefined();
  const odd: WorkersAi = { run: async () => ({ answers: { intent: { choice: "dance", confidence: 0.9 } } }) };
  expect(await decideTurn(odd, { app: "care", said: "hi" })).toBeUndefined();
  // A yes-or-no Clef leaves out counts as yes: the careful side, no lane.
  const terse: WorkersAi = { run: async () => ({ answers: { intent: { choice: "next_appointment", confidence: 0.95 } } }) };
  expect(await decideTurn(terse, { app: "care", said: "hi" })).toMatchObject({ asksQuestion: true, cancels: true, emergency: 0 });
  let signal: AbortSignal | undefined;
  const slow: WorkersAi = { run: (_, __, options) => { signal = options?.signal; return new Promise(() => {}); } };
  const began = Date.now();
  expect(await decideTurn(slow, { app: "care", said: "hi" }, 40)).toBeUndefined();
  expect(Date.now() - began).toBeLessThan(500);
  expect(signal).toBeInstanceOf(AbortSignal);
});
