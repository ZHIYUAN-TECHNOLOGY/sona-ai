import { expect, test } from "bun:test";
import { DOCTORS, matchDoctors } from "../doctors/data";
import { answer, conditionOf, doctorQuestion, historyOf, leadOf, NO_ANSWER, shown, spoken, startingLine, suggestions, urgent, wantsDoctor } from "./answers";

const medicines = {
  new: [{ name: "Paracetamol", line: "For pain or fever: 1 g every 6 hours if you need it, no more than 4 g a day" }],
  changed: [{ name: "Azithromycin", line: "Now a tablet once a day, for 2 more days", take: "1 tablet, with or without food", at: ["08:00"], doses: 2 }],
  stopped: [{ name: "Salbutamol nebuliser", line: "Use your own inhaler instead, when you need it" }],
  continue: [{ name: "Cetirizine", line: "Keep taking it as before", take: "1 tablet at night", at: ["21:00"] }],
};
const leaflets = [{ language: "en", label: "EN", name: "English", text: "You were treated for a chest infection. Take azithromycin once a day for 2 more days." }];
const plan = { medicines, leaflets };
const visit = { title: "Clinic review", date: new Date("2026-10-11T02:00:00Z"), why: "To see how you're doing after your pneumonia", inDays: 14 };

test("three questions from the plan: the next dose, the new medicine, the next visit", () => {
  const [miss, fresh, next, ...rest] = suggestions(plan, visit, "Cetirizine");
  expect(rest).toEqual([]);
  expect(miss.question).toBe("What if I miss a dose of Cetirizine?");
  expect(miss.answer).toBe("Your plan doesn't say what to do if you miss a dose of Cetirizine, so ask your care team. Never take two doses at once to make up for one. Your usual dose: 1 tablet at night, at 9:00\u00a0PM.");
  expect(miss.source).toBe("From your Cetirizine instructions");
  expect(miss.kind).toBe("dose");
  expect(fresh).toEqual({ question: "What is Paracetamol for?", answer: "Your plan says: For pain or fever: 1 g every 6 hours if you need it, no more than 4 g a day.", source: "From your Paracetamol instructions", kind: "medicine" });
  expect(next).toEqual({ question: "When is my next visit?", answer: "Clinic review, Sun 11 Oct (in 14 days). To see how you're doing after your pneumonia.", source: "From your discharge plan", kind: "visit" });
});

test("the missed-dose answer follows the plan's own wording when it has one, and still says never two at once", () => {
  const worded = { medicines, leaflets: [{ ...leaflets[0], text: "Take azithromycin once a day. If you forget a dose, take it when you remember that day. Rest well." }] };
  const [miss] = suggestions(worded, undefined);
  expect(miss.question).toBe("What if I miss a dose of Azithromycin?"); // no next dose given: the first medicine on a schedule
  expect(miss.answer).toBe("Your plan says: If you forget a dose, take it when you remember that day. Never take two doses at once to make up for one.");
  expect(miss.source).toBe("From your discharge plan");
});

test("with no next dose, the missed-dose question skips a finished course", () => {
  const done = { ...medicines, changed: [{ ...medicines.changed[0], finished: true }] };
  expect(suggestions({ medicines: done, leaflets }, undefined)[0].question).toBe("What if I miss a dose of Cetirizine?");
});

test("with no new medicine it asks what changed; with nothing planned it offers nothing", () => {
  const [, changed] = suggestions({ medicines: { ...medicines, new: [] }, leaflets }, undefined, "Azithromycin");
  expect(changed).toEqual({ question: "What changed with Azithromycin?", answer: "Your plan says: Now a tablet once a day, for 2 more days.", source: "From your Azithromycin instructions", kind: "medicine" });
  expect(suggestions(undefined, undefined)).toEqual([]);
  expect(suggestions({ medicines: { new: [], changed: [], stopped: [], continue: [] }, leaflets }, undefined)).toEqual([]);
});

test("urgent words put the 999 line first; everyday questions do not", () => {
  for (const t of ["I have chest pain", "my chest feels tight", "pain in my chest", "I'm short of breath", "can't breathe properly", "I fainted this morning", "I passed out", "coughing up blood", "the wound is bleeding", "my lips look blue", "I want to end my life"])
    expect(urgent(t)).toBe(true);
  for (const t of ["Can I drink coffee?", "What is my blood pressure target?", "When can I drive again?", "Can I take it with food?"])
    expect(urgent(t)).toBe(false);
});

test("the plan's condition comes from the leaflet's 'treated for', and names the find-a-doctor row", () => {
  expect(conditionOf(plan)).toBe("chest infection");
  expect(doctorQuestion(conditionOf(plan))).toBe("Find a doctor for my chest infection");
  expect(conditionOf({ medicines, leaflets: [] })).toBeUndefined();
  expect(conditionOf(undefined)).toBeUndefined();
});

// care.ask as the server answers it: no model on (a fixture), a model, or a failed call; the directory searched as care.doctors.list does.
const fixture = async () => ({ answer: "", grounded: false, urgent: false, source: "fixture" });
const failing = async () => { throw new Error("offline"); };
const modelSays = reply => async () => ({ ...reply, source: "model", model: "gemma" });
const directory = async search => search ? matchDoctors(DOCTORS, search) : DOCTORS;
const api = (ask, doctors = directory) => ({ ask, doctors });

test("any question goes to the model first; a plan question's authored answer only when no model is on or the call fails", async () => {
  const asks = suggestions(plan, visit, "Cetirizine");
  const asked = [];
  const grounded = modelSays({ answer: "Your next visit is the clinic review on 11 October.", grounded: true, urgent: false, from: "follow-up" });
  expect(await answer("When is my next visit?", asks, api(async q => { asked.push(q); return grounded(); }), "chest infection")).toEqual({
    kind: "plan", asked: { question: "", answer: "Your next visit is the clinic review on 11 October.", source: "From your record · follow-up", kind: "medicine" },
  });
  expect(asked).toEqual(["When is my next visit?"]);
  expect(await answer("when is my next visit?", asks, api(fixture), "chest infection")).toEqual({ kind: "plan", asked: asks[2] });
  expect(await answer("When is my next visit?", asks, api(failing))).toEqual({ kind: "plan", asked: asks[2] });
  // The label is in her language, the plan's part too (the model names it in English); a part not known shows as written.
  const sourceIn = async (lang, reply) => (await answer("Bila?", [], api(modelSays({ answer: "Esok.", urgent: false, ...reply })), undefined, lang)).asked.source;
  expect(await sourceIn("ms", { grounded: true, from: "Warning signs" })).toBe("Daripada rekod anda · tanda amaran");
  expect(await sourceIn("zh", { grounded: true, from: "medicines" })).toBe("来自您的病历 · 药物");
  // The record's other parts (what the hospital recorded about her) are named in her language too.
  expect(await sourceIn("ms", { grounded: true, from: "allergies" })).toBe("Daripada rekod anda · alahan");
  expect(await sourceIn("zh", { grounded: true, from: "results" })).toBe("来自您的病历 · 检查结果");
  expect(await sourceIn("en", { grounded: true, from: "check-ins" })).toBe("From your record · check-ins");
  expect(await sourceIn("en", { grounded: true, from: "note" })).toBe("From your record · doctor's note");
  expect(await sourceIn("ms", { grounded: true, from: "family" })).toBe("Daripada rekod anda · family");
  expect(await sourceIn("zh", { grounded: true })).toBe("来自您的病历");
  expect(await sourceIn("ms", { grounded: false })).toBe("Jawapan umum · bukan daripada rekod anda");
  expect(await sourceIn("zh", { grounded: false })).toBe("一般回答 · 并非来自您的病历");
  // No content limit: an answer from general knowledge is shown too, marked as not from their records.
  expect(await answer("Can I drink coffee?", asks, api(modelSays({ answer: "A cup of coffee is fine for most people.", grounded: false, urgent: false })))).toEqual({
    kind: "plan", asked: { question: "", answer: "A cup of coffee is fine for most people.", source: "General answer · not from your records", kind: "medicine" },
  });
  // A warning sign is the 999 card, whatever the answer says.
  expect(await answer("Can I drink coffee?", asks, api(modelSays({ answer: "Call 999 now.", grounded: false, urgent: true })))).toEqual({ kind: "none", urgent: true });
});

test("the missed-dose question is the model's to answer; its authored words only when no model is on or the call fails", async () => {
  const asks = suggestions(plan, visit, "Cetirizine");
  const asked = [];
  const model = modelSays({ answer: "Take it when you remember, unless it is nearly time for the next one.", grounded: false, urgent: false });
  const reply = await answer("What if I miss a dose of Cetirizine?", asks, api(async q => { asked.push(q); return model(); }));
  expect(asked).toEqual(["What if I miss a dose of Cetirizine?"]);
  expect(reply.asked.answer).toBe("Take it when you remember, unless it is nearly time for the next one.");
  expect(await answer("What if I miss a dose of Cetirizine?", asks, api(fixture))).toEqual({ kind: "plan", asked: asks[0] });
  expect(await answer("What if I miss a dose of Cetirizine?", asks, api(failing))).toEqual({ kind: "plan", asked: asks[0] });
});

test("the chat so far goes with a follow-up: the last 6 answered turns, oldest first, in the words the patient got; a new chat has none", () => {
  const said = (question, answer) => ({ question, reply: { kind: "plan", asked: { question: "", answer, source: "General answer · not from your records", kind: "medicine" } }, ready: true });
  expect(historyOf([])).toEqual([]);
  const chat = [said("What is panadol?", "Panadol is paracetamol, for pain and fever.")];
  // The question still waiting for its answer is not history yet.
  expect(historyOf([...chat, { question: "How does it help?", reply: { kind: "none", urgent: false }, ready: false }])).toEqual([
    { question: "What is panadol?", answer: "Panadol is paracetamol, for pain and fever." },
  ]);
  const eight = Array.from({ length: 8 }, (_, i) => said(`Q${i}`, `A${i}`));
  expect(historyOf(eight).map(h => h.question)).toEqual(["Q2", "Q3", "Q4", "Q5", "Q6", "Q7"]);
  // Each answer as the patient got it: the care team's line, the 999 line, the doctors by name; cut to care.ask's limits.
  const careTeam = { taskId: "t", title: "x", line: "I've let your care team know." };
  expect(historyOf([{ question: "I have chest pain", reply: { kind: "none", urgent: true, careTeam }, ready: true }])[0].answer).toBe("If this is happening now, call 999. I've let your care team know.");
  const long = historyOf([said("q".repeat(2500), "a".repeat(5000))])[0];
  expect([long.question.length, long.answer.length]).toEqual([2000, 4000]);
});

test("an answer that used one of the hospital's leaflets names it; from her record too, both captions show; general is only what is from neither", async () => {
  const captions = async (lang, reply) => { const { asked } = await answer("Bila?", [], api(modelSays({ answer: "Esok.", urgent: false, ...reply })), undefined, lang); return [asked.source, asked.leaflet]; };
  const chest = { title: "Chest infection", kind: "leaflet" }, home = { title: "Going home from hospital", kind: "leaflet" };
  expect(await captions("en", { grounded: false, sources: [chest] })).toEqual(["From the hospital's leaflet · Chest infection", undefined]);
  expect(await captions("ms", { grounded: false, sources: [{ title: "Jangkitan paru-paru", kind: "leaflet" }] })).toEqual(["Daripada risalah hospital · Jangkitan paru-paru", undefined]);
  expect(await captions("zh", { grounded: false, sources: [{ title: "肺部感染", kind: "leaflet" }] })).toEqual(["来自医院的说明单 · 肺部感染", undefined]);
  expect(await captions("en", { grounded: true, from: "medicines", sources: [chest, home] })).toEqual(["From your record · medicines", "From the hospital's leaflet · Chest infection and Going home from hospital"]);
  // No leaflet used (or a server from before leaflets): the captions are as they were.
  expect(await captions("en", { grounded: false, sources: [] })).toEqual(["General answer · not from your records", undefined]);
  expect(await captions("en", { grounded: true })).toEqual(["From your record", undefined]);
});

test("while the model starts, the fallback reply says how long, in the patient's language", async () => {
  const asks = suggestions(plan, visit, "Cetirizine");
  const starting = minutes => async () => ({ answer: "", grounded: false, urgent: false, source: "fixture", waking: minutes });
  expect(await answer("When is my next visit?", asks, api(starting(3)))).toEqual({ kind: "plan", asked: asks[2], waking: 3 });
  expect(await answer("Can I drink coffee?", asks, api(starting(1)))).toEqual({ kind: "none", urgent: false, waking: 1 });
  expect(startingLine(3)).toBe("Sona Care is starting up, about 3 min");
  expect(startingLine(1)).toBe("Sona Care is starting up, about a minute");
  expect(startingLine(3, "ms")).toBe("Sona Care sedang dimulakan, kira-kira 3 minit lagi");
  expect(startingLine(1, "zh")).toBe("Sona Care 正在启动，大约还要一分钟");
});

test("anything else is the model's grounded answer, or the honest no (urgent when the model heard a warning sign)", async () => {
  const asks = suggestions(plan, visit, "Cetirizine");
  expect(await answer("Can I drink coffee?", asks, api(fixture))).toEqual({ kind: "none", urgent: false });
  expect(spoken(await answer("Can I drink coffee?", asks, api(failing)))).toBe(NO_ANSWER);
  expect(await answer("I feel confused", asks, api(modelSays({ answer: "Call 999 now.", grounded: false, urgent: true })))).toEqual({ kind: "none", urgent: true });
  const bm = await answer("Boleh saya minum kopi?", asks, api(modelSays({ answer: "Pelan anda tidak menyebut kopi.", grounded: true, urgent: false })), undefined, "ms");
  expect(bm.asked.source).toBe("Daripada rekod anda");
});

test("doctor questions search the directory: by the question's words, else the plan's condition, else the care team (1–3)", async () => {
  expect(wantsDoctor("Find a doctor for my chest infection")).toBe(true);
  expect(wantsDoctor("Who is the best heart specialist?")).toBe(true);
  expect(wantsDoctor("My doctor said rest")).toBe(false);
  const searched = [];
  const tracked = api(failing, async search => { searched.push(search); return directory(search); });

  const forPlan = await answer(doctorQuestion("chest infection"), [], tracked, "chest infection");
  expect(forPlan.kind).toBe("doctors");
  expect(forPlan.doctors.map(d => d.id)).toEqual(["lim", "aisyah"]);
  expect(forPlan.text).toBe("Here are doctors who may help with your chest infection.");
  expect(spoken(forPlan)).toBe("Here are doctors who may help with your chest infection. Dr. Lim Wei Jie (Respiratory) and Dr. Aisyah Rahman (Cardiology).");
  expect(searched).toEqual(["Find a doctor for my chest infection", "chest infection"]); // the model is never asked

  const heart = await answer("Who is the best heart specialist?", [], tracked, "chest infection");
  expect(heart.doctors.map(d => d.id)).toEqual(["aisyah"]);
  expect(heart.text).toBe("Here is a doctor who may help.");

  expect((await answer("Can you find me a doctor?", [], tracked, "chest infection")).doctors.map(d => d.id)).toEqual(["lim", "aisyah"]);
  expect((await answer("Can you find me a doctor?", [], tracked)).doctors.every(d => d.careTeam)).toBe(true);
  // The directory out of reach, or empty: the honest no.
  expect(await answer("Can you find me a doctor?", [], api(failing, failing))).toEqual({ kind: "none", urgent: false });
  expect(await answer("Can you find me a doctor?", [], api(failing, async () => []))).toEqual({ kind: "none", urgent: false });
});

test("urgent words win: the 999 line, even when asking for a doctor or when the server is out of reach", async () => {
  expect(await answer("I have chest pain, find me a doctor", [], api(failing, failing), "chest infection")).toEqual({ kind: "none", urgent: true });
  expect(spoken({ kind: "none", urgent: true })).toBe("If this is happening now, call 999. This needs your care team. Shall I send it to them now?");
  expect(spoken({ kind: "none", urgent: true }, "ms")).toMatch(/^.+ Ini perlu dimaklumkan kepada pasukan penjagaan anda\./);
});

// care.ask's `careTeam`: the flagged task and Sona's line, there once the server has told the care team.
const careTeam = { taskId: "task-1", title: "Amelia: chest pain after discharge", line: "I've let your care team know." };

test("a typed emergency still reaches the server, and the 999 reply carries the care team's task, model or no model", async () => {
  const asked = [];
  const reply = await answer("I have chest pain", [], api(async q => { asked.push(q); return { ...(await fixture()), careTeam }; }));
  expect(asked).toEqual(["I have chest pain"]);
  expect(reply).toEqual({ kind: "none", urgent: true, careTeam });
  // Her line stands in for "Send it to your care team?": shown once, and after the 999 line when read aloud.
  expect(shown(reply)).toBe("I've let your care team know.");
  expect(spoken(reply)).toBe("If this is happening now, call 999. I've let your care team know.");
  // Typed warning words are the 999 card whatever a model says back; no task made, no line.
  expect(await answer("I have chest pain", [], api(modelSays({ answer: "Rest and drink water.", grounded: false, urgent: false, careTeam })))).toEqual({ kind: "none", urgent: true, careTeam });
  expect(await answer("I have chest pain", [], api(fixture))).toEqual({ kind: "none", urgent: true });
});

test("a problem that is not an emergency carries the care team's line too: after a model's answer, or alone when no model is on", async () => {
  const answered = await answer("My cough is worse today", [], api(modelSays({ answer: "Rest and keep taking your tablets.", grounded: false, urgent: false, careTeam })));
  expect(answered).toMatchObject({ kind: "plan", careTeam });
  expect(shown(answered)).toBe("Rest and keep taking your tablets. I've let your care team know.");
  expect(spoken(answered)).toBe(shown(answered));
  // The line is the server's, in the plan's language.
  const ms = { ...careTeam, line: "Saya sudah maklumkan pasukan penjagaan anda." };
  const off = await answer("Batuk saya makin teruk", [], api(async () => ({ ...(await fixture()), careTeam: ms })), undefined, "ms");
  expect(off).toEqual({ kind: "none", urgent: false, careTeam: ms });
  expect(shown(off, "ms")).toBe("Saya sudah maklumkan pasukan penjagaan anda.");
  // The model's own warning sign: the 999 card, with the line.
  expect(await answer("I feel confused", [], api(modelSays({ answer: "Call 999 now.", grounded: false, urgent: true, careTeam })))).toEqual({ kind: "none", urgent: true, careTeam });
  expect(shown({ kind: "none", urgent: false })).toBe(NO_ANSWER);
});

test("an answer's lead sentence is split from the rest, never at Dr.", () => {
  expect(leadOf("Your plan says: take it at night. Never take two.")).toEqual(["Your plan says: take it at night.", "Never take two."]);
  expect(leadOf("See Dr. Tan first. Then rest.")).toEqual(["See Dr. Tan first.", "Then rest."]);
  expect(leadOf("One sentence only.")).toEqual(["One sentence only.", ""]);
});

test("an answer's marks and cards ride beside its words, read loosely: old kinds renamed, what this build can't read left out; a lane's answer shows too", async () => {
  const medicine = { type: "medicine", name: "Azithromycin", dose: "1 tablet", times: ["08:00"], source: "Your discharge plan" };
  const reply = await answer("How do I take it?", [], api(modelSays({
    answer: "Take azithromycin 1 tablet once a day.", grounded: true, urgent: false, from: "medicines",
    marks: [{ text: "azithromycin", kind: "medicine" }, { text: "once a day", kind: "when" }, { text: "1 tablet", kind: "sparkle" }],
    cards: [medicine, { type: "chart", points: [] }, { type: "result", test: "Potassium" }],
  })));
  expect(reply.asked.marks).toEqual([{ text: "azithromycin", kind: "medicine" }, { text: "once a day", kind: "dose" }]);
  expect(reply.asked.cards).toEqual([medicine]);
  // An older server sends neither: no marks (the word lists colour) and no cards.
  const plain = await answer("Can I drink coffee?", [], api(modelSays({ answer: "Yes, a cup is fine.", grounded: false, urgent: false })));
  expect(plain.asked.marks).toBeUndefined();
  expect(plain.asked.cards).toBeUndefined();
  // The Clef fast lane answered the turn: its words show whatever its source says.
  const lane = await answer("When is my next visit?", [], api(async () => ({ answer: "Your clinic review is on 24 October.", grounded: true, urgent: false, source: "lane", lane: { intent: "next_appointment", confidence: 0.93, by: "clef-omni" } })));
  expect(lane.asked.answer).toBe("Your clinic review is on 24 October.");
});
