import { triageByRules } from "@sona-ai/domain/messages";
import { expect, test } from "bun:test";

import { chatModels, marksIn, streamingAnswer, stringSoFar } from "./chat-models";
import { stubModels } from "./models";
import { messagesFor } from "./voice-agent/answer";

test("the safety floor says so: the rule's urgent words decide over a model's milder reading, and the answer names both", async () => {
  // A model that reads everything mildly: "fine" for a check-in reply, "admin" for a message.
  const models = chatModels(async system => system.includes("check-in") ? { label: "fine" } : { label: "admin", reason: "asks about a bill" }, "chat-test", stubModels);
  expect(await models.classifyReply({ text: "chest pain since this morning", language: "en" })).toEqual({ label: "urgent", source: "model", model: "chat-test", decidedBy: "rules" });
  expect(await models.classifyReply({ text: "Feeling better today", language: "en" })).toEqual({ label: "fine", source: "model", model: "chat-test", decidedBy: "model" });
  expect(await models.triageMessage({ text: "Sakit dada sejak pagi" })).toEqual({ ...triageByRules("Sakit dada sejak pagi"), source: "model", model: "chat-test", decidedBy: "rules" });
  expect(await models.triageMessage({ text: "Where do I pay my bill?" })).toEqual({ label: "admin", reason: "asks about a bill", source: "model", model: "chat-test", decidedBy: "model" });
  // A model that agrees it is urgent decided its own label; one that fails leaves the rules, labelled fixture.
  const agrees = chatModels(async () => ({ label: "urgent", symptom: "chest pain" }), "chat-test", stubModels);
  expect((await agrees.classifyReply({ text: "chest pain since this morning", language: "en" })).decidedBy).toBe("model");
  const down = chatModels(async () => { throw new Error("down"); }, "chat-test", stubModels);
  expect(await down.classifyReply({ text: "chest pain since this morning", language: "en" })).toEqual({ label: "urgent", source: "fixture" });
});

test("an answer in the wrong language is asked for once more, with the same conversation before the question", async () => {
  const said: string[] = [];
  const models = chatModels(async (_, user) => {
    said.push(user);
    return { answer: said.length === 1 ? "Panadol ialah parasetamol, ubat biasa untuk sakit dan demam." : "It eases pain and brings a fever down.", grounded: false, urgent: false };
  }, "chat-test", stubModels);
  const answer = await models.answerFromPlan({ question: "How does it help?", plan: "", language: "en", history: [{ question: "What is panadol", answer: "Panadol is paracetamol." }] });
  expect(answer).toMatchObject({ answer: "It eases pain and brings a fever down.", source: "model" });
  expect(said).toHaveLength(2);
  for (const s of said) expect(s).toStartWith("Conversation so far:\nPatient: What is panadol\nSona Care: Panadol is paracetamol.\n\nPatient's question, written in English.");
  expect(said[1]).toContain("Your last answer was not in English");
});

test("an empty reply is asked for once more, not answered by the stub", async () => {
  const said: string[] = [];
  const models = chatModels(async (_, user) => { said.push(user); return said.length === 1 ? {} : { answer: "There is no strong evidence that vitamin C prevents flu.", grounded: false, urgent: false }; }, "chat-test", stubModels);
  expect(await models.answerFromPlan({ question: "Is it true vitamin C can prevent flu?", plan: "", language: "en" })).toMatchObject({ answer: "There is no strong evidence that vitamin C prevents flu.", source: "model" });
  expect(said).toHaveLength(2);
  expect(said[1]).toContain("Your last reply held no answer");
});

test("typed and spoken answers both put her record's numbers, an asthma attack and a febrile baby before the usual numbers, and no made-up dose time", async () => {
  let typed = "";
  await chatModels(async system => { typed = system; return { answer: "ok" }; }, "chat-test", stubModels).answerFromPlan({ question: "How much water?", plan: "", language: "en" });
  const spoken = messagesFor({ question: "How much water?", plan: "", language: "en", history: [] })[0]!.content;
  // A typed answer's emergency signs name a drowsy baby: the child doses had pulled "my baby has a high fever and is very
  // lethargic" into a dose with no 999 (10 Oct gate). A call's own triage word already says 999.
  expect(typed).toContain("a baby or child very drowsy, floppy or hard to wake)");
  for (const prompt of [typed, spoken]) {
    expect(prompt).toContain("their record's own number when it holds one (their dose, a fluid limit)");
    expect(prompt).toContain("1 puff every 30 to 60 seconds up to 10");
    expect(prompt).toContain("(with heart failure or kidney disease, their fluid limit instead)");
    expect(prompt).toContain("(a baby under 1 year: by their own weight only; under 3 months with a fever: a doctor must see them today and sets the dose, so no amount)");
    expect(prompt).toContain("a line with no times has none to count from: say how often it is taken");
  }
});

test("neither a typed nor a spoken answer says Sona did something only the app does (11 Oct Clef trial: \"sudah simpan bacaan\" with nothing saved)", async () => {
  let typed = "";
  await chatModels(async system => { typed = system; return { answer: "ok" }; }, "chat-test", stubModels).answerFromPlan({ question: "BP saya 135/85", plan: "", language: "ms" });
  const spoken = messagesFor({ question: "BP saya 135/85", plan: "", language: "ms", history: [] })[0]!.content;
  for (const prompt of [typed, spoken]) expect(prompt).toContain("Never say you saved, recorded, booked or sent anything, or told their doctor or care team, or that you will.");
});

test("marks are read grouped by kind or as the old list, each colouring every time its words stand in the answer, as the answer writes them", () => {
  const answer = "Take Paracetamol 1 g every 6 hours for the fever, at most 4 g a day; 1 glass of water with it. Call 999 if you have chest pain. Paracetamol is safe with azithromycin.";
  const grouped = { medicine: ["paracetamol", "Azithromycin", "ibuprofen"], dose: ["1 g", "every 6 hours", "4 g a day"], symptom: ["fever", "pain"], warning: ["Call 999", "chest pain"], sparkle: ["water"] };
  expect(marksIn(grouped, answer)).toEqual([
    { text: "Paracetamol", kind: "medicine" }, { text: "1 g", kind: "dose" }, { text: "every 6 hours", kind: "dose" }, { text: "fever", kind: "symptom" },
    { text: "4 g a day", kind: "dose" }, { text: "Call 999", kind: "warning" }, { text: "chest pain", kind: "warning" }, { text: "Paracetamol", kind: "medicine" }, { text: "azithromycin", kind: "medicine" },
  ]);
  // A reply from before 11 Oct (a list, the old kind names) still colours, in the new kinds.
  expect(marksIn([{ text: "1 g", kind: "when" }, { text: "low potassium", kind: "alert" }, { text: "Hypokalaemia", kind: "finding" }], "1 g now. Hypokalaemia, a low potassium.")).toEqual([
    { text: "1 g", kind: "dose" }, { text: "Hypokalaemia", kind: "condition" }, { text: "low potassium", kind: "warning" },
  ]);
  // Chinese has no spaces between words: a phrase inside a longer run still colours.
  expect(marksIn({ dose: ["饭后"], medicine: ["阿奇霉素"] }, "阿奇霉素每天一次，饭后服用。")).toEqual([{ text: "阿奇霉素", kind: "medicine" }, { text: "饭后", kind: "dose" }]);
  expect(marksIn(undefined, answer)).toBeUndefined();
  expect(marksIn({}, answer)).toEqual([]);
});

test("the typed answer asks for every kind of mark, grouped", async () => {
  let typed = "";
  await chatModels(async system => { typed = system; return { answer: "ok" }; }, "chat-test", stubModels).answerFromPlan({ question: "Bila makan ubat?", plan: "", language: "ms" });
  for (const kind of ["warning", "caution", "medicine", "dose", "condition", "symptom", "test"]) expect(typed).toContain(`  - "${kind}": `);
  expect(typed).toContain(`"marks": {"<kind>": ["<words copied from the answer>"]}`);
});

test("a streamed answer: its words so far as each piece lands (a cut escape waits for its rest), and a retry starts them again", async () => {
  expect(stringSoFar('{"answer": "Ambil \\"Panadol\\" \\u996d', "answer")).toBe('Ambil "Panadol" 饭');
  expect(stringSoFar('{"answer": "Ambil \\"Panadol\\" \\u99', "answer")).toBe('Ambil "Panadol" ');
  expect(stringSoFar('{"answer": "a\\nb\\\\', "answer")).toBe("a\nb\\");
  expect(stringSoFar('{"answer": "a\\', "answer")).toBe("a");
  expect(stringSoFar('{"grounded": true, "answ', "answer")).toBeUndefined();
  expect(stringSoFar('{"answer": "done", "from": "x"}', "answer")).toBe("done");
  // Gemma's first reply is "{}" (10 Oct gate), so she is asked again: the words come from the second.
  const replies = ["{}", JSON.stringify({ answer: "Take paracetamol 1 g [2] every 6 hours.", grounded: false, urgent: false, cites: [2], marks: { dose: ["1 g"] } })];
  const heard: string[] = [];
  const answer = await streamingAnswer(async () => (async function* () { yield* replies.shift()!.match(/[\s\S]{1,4}/g)!; })(), "chat-test", stubModels, w => heard.push(w))({ question: "How much paracetamol?", plan: "", language: "en" });
  expect(answer).toEqual({ answer: "Take paracetamol 1 g every 6 hours.", grounded: false, urgent: false, cites: [2], marks: [{ text: "1 g", kind: "dose" }], source: "model", model: "chat-test" });
  expect(heard.at(-1)).toBe(answer.answer);
  expect(heard.some(w => w.includes("["))).toBe(false);
});
