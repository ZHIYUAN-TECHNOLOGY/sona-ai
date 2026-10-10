import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { DEMO_HOSPITAL } from "@sona-ai/db/demo";
import { encounters, guaranteeLetters, labResults, receipts } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { doseKey, doseSlots } from "@sona-ai/domain/doses";
import { eq } from "drizzle-orm";

import { stubModels, type Models } from "../models";
import { TEXT_MODEL, workersModels, type WorkersAi } from "../workers-models";
import { messagesFor } from "../voice-agent/answer";
import { RECORD_CHARS, recordText } from "./care-plan";
import { appRouter } from "./index";

const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

/** Amelia discharged and joined; `models` is what the Worker would pass (the stub when undefined). */
async function world(models?: Models) {
  const now = new Date("2026-09-28T10:05:00+08:00");
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T15:40:00+08:00"));
  await addClinician(db, "dr-aisyah");
  await db.update(guaranteeLetters).set({ status: "received", receivedAt: now }).where(eq(guaranteeLetters.id, "gl-1042"));
  await db.update(encounters).set({ state: { discharge: { glReceived: true, medsConfirmed: true, followUp: "2w", language: "ms" } } }).where(eq(encounters.id, "visit-1042"));
  const as = (id: string) => createRouterClient(appRouter, { context: { db, session: user(id), now: () => now, models } });
  const doctor = as("dr-aisyah"), amelia = as("amelia-account");
  await doctor.discharge.request({ encounterId: "visit-1042", requestId: "req-d1", approvedBy: "dr-aisyah" });
  await amelia.care.join({ code: (await doctor.care.code({ encounterId: "visit-1042" })).code });
  return { doctor, amelia, db, as };
}

test("without a speech model, speaking is refused plainly and asking answers nothing (the app keeps its own answers)", async () => {
  const { amelia } = await world();
  const e = await amelia.care.transcribe({ audio: btoa("RIFF-some-audio-bytes") }).catch(e => e);
  expect([e.code, e.data?.code, e.message]).toEqual(["PRECONDITION_FAILED", "SPEECH_OFF", "Speaking to Sona Care isn't switched on yet. Please type instead."]);
  expect(await amelia.care.ask({ question: "Bila saya makan ubat?" })).toEqual({ answer: "", grounded: false, urgent: false, sources: [], withheld: 0, source: "fixture" });
  // No voice: no audio, so the phone reads the answer.
  expect(await amelia.care.speak({ text: "Ambil ubat ini selepas makan." })).toEqual({ source: "fixture" });
});

test("while the models are starting, speaking says in how many minutes, and so does the sample answer", async () => {
  const { amelia } = await world({
    ...stubModels,
    transcribe: async () => ({ text: "", source: "fixture" as const, waking: 30 }),
    speak: async () => ({ source: "fixture" as const, waking: 30 }),
    answerFromPlan: async () => ({ answer: "", grounded: false, urgent: false, source: "fixture" as const, waking: 12 }),
  });
  const e = await amelia.care.transcribe({ audio: btoa("RIFF-some-audio-bytes") }).catch(e => e);
  expect([e.code, e.data?.code, e.message]).toEqual(["PRECONDITION_FAILED", "SPEECH_OFF", "Speaking to Sona Care is starting (about 30 min). Please type instead, or try again then."]);
  expect(await amelia.care.ask({ question: "Bila saya makan ubat?" })).toEqual({ answer: "", grounded: false, urgent: false, sources: [], withheld: 0, source: "fixture", waking: 12 });
  expect(await amelia.care.speak({ text: "Ambil ubat ini selepas makan." })).toEqual({ source: "fixture", waking: 30 });
});

test("with Sona's voice, a part of an answer comes back as WAV with the model that spoke it; a long text is refused, so a part stays short", async () => {
  let spoken = "";
  const { amelia } = await world({ ...stubModels, speak: async ({ text }) => { spoken = text; return { audio: btoa("RIFF-wav"), source: "model" as const, model: "sona-voxcpm2-malaysian" }; } });
  expect(await amelia.care.speak({ text: "  Ambil ubat ini selepas makan. " })).toEqual({ audio: btoa("RIFF-wav"), source: "model", model: "sona-voxcpm2-malaysian" });
  expect(spoken).toBe("Ambil ubat ini selepas makan.");
  const long = await amelia.care.speak({ text: "a".repeat(301) }).catch(e => e);
  expect(long.code).toBe("BAD_REQUEST");
});

test("with the model, her Manglish reply flags the doctor with the model's own words, and her question is grounded in her plan", async () => {
  const asked: string[] = [];
  const ai: WorkersAi = {
    async run(model, input) {
      const text = JSON.stringify(input);
      asked.push(text);
      if (text.includes("Patient's record")) return { response: '{"answer":"Ambil Azithromycin sekali sehari.","grounded":true,"urgent":false,"from":"medicines"}' };
      return { response: '{"label":"worse","symptom":"Fever back, cough worse"}' };
    },
  };
  const { doctor, amelia } = await world(workersModels(ai));
  const replied = await amelia.care.checkIns.reply({ checkInId: "check-in:visit-1042:2", text: "Demam balik, batuk makin teruk" });
  expect(replied.replies[0]).toMatchObject({ label: "worse", source: TEXT_MODEL, task: { title: "Amelia: fever back, cough worse after discharge" } });
  expect((await doctor.tasks.list()).some(t => t.title === "Amelia: fever back, cough worse after discharge")).toBe(true);

  const answer = await amelia.care.ask({ question: "Bila saya makan ubat?" });
  expect(answer).toEqual({ answer: "Ambil Azithromycin sekali sehari.", grounded: true, urgent: false, sources: [], withheld: 0, from: "medicines", source: "model", model: TEXT_MODEL });
  // Only her own record went to the model: her medicines and warning signs, nobody else's record.
  const prompt = asked.find(a => a.includes("Patient's record"))!;
  expect(prompt).toContain("Azithromycin");
  expect(prompt).toContain("The fever comes back");
  expect(prompt).not.toContain("SYN-1086");
  expect(prompt).not.toContain("Discharge plan:");
});

test("her question is answered from her own record as recorded (history, allergy, results, note, check-in reply, doses), and never from another patient's rows", async () => {
  const read: string[] = [];
  const models: Models = { ...stubModels, answerFromPlan: async input => { read.push(input.plan); return { answer: "", grounded: false, urgent: false, source: "fixture" }; } };
  const { doctor, amelia, db, as } = await world(models);
  await db.insert(labResults).values({ id: "lab-1042-crp", patientId: "SYN-1042", test: "CRP", value: "48", unit: "mg/L", flag: "high", sourceId: "lab-1042-crp", receivedAt: new Date("2026-09-26T09:00:00+08:00") });
  await doctor.note.save({ encounterId: "visit-1042", expectedRevision: 0, sentences: [{ id: "assessment", text: "Community-acquired pneumonia, mild; CURB-65 0." }, { id: "plan", text: "Oral azithromycin for 2 more days." }] });
  await amelia.care.checkIns.reply({ checkInId: "check-in:visit-1042:2", text: "Demam balik, batuk makin teruk" });
  // What her doctor prescribed in hospital, with how often: an amendment's newer receipt wins over the first.
  const rx = (id: string, frequency: string, at: string) => ({ id, kind: "prescription" as const, encounterId: "visit-1042", requestId: id, revision: 0, approvedBy: "dr-aisyah", createdAt: new Date(at),
    payload: { medication: "Paracetamol", formulation: "500 mg tablet", dose: "1000", unit: "mg", route: "Oral", frequency, duration: "3 days" } });
  await db.insert(receipts).values([rx("rx-1", "Every 4 hours", "2026-09-26T09:00:00+08:00"), rx("rx-2", "Every 6 hours", "2026-09-27T09:00:00+08:00")]);
  await amelia.care.ask({ question: "Am I allergic to anything?" });
  const hers = read[0]!;
  for (const recorded of [
    "Medicines:", "Now: Mon, 28 Sep 2026 10:05 (Malaysia time)",
    "Recorded by the hospital:\nAge 42, female. Came in with: Cough for five days, with fever since yesterday.",
    "History: Asthma since childhood", "Family history: Mother has asthma", "Allergies: Penicillin — reported rash", "Medicines before admission: Salbutamol inhaler, as needed",
    "Urea 5.1 mmol/L", "Results:\n- CRP 48 mg/L, high (Sat, 26 Sep 2026)",
    "Prescribed by her doctor in hospital:\n- Paracetamol, 500 mg tablet, 1000 mg, Oral, Every 6 hours, for 3 days (approved Sun, 27 Sep 2026)",
    "Doctor's note (saved ", "Community-acquired pneumonia, mild; CURB-65 0. Oral azithromycin for 2 more days.",
    'Check-in replies:\n- Day 2 check-in, Mon, 28 Sep 2026: "Demam balik, batuk makin teruk" (read as worse)',
  ]) expect(hers).toContain(recorded);
  expect(hers.length).toBeLessThanOrEqual(RECORD_CHARS);
  // The text says who she is by her record, not by name or number, and holds none of the other patient's rows (his potassium, his history).
  expect(hers).not.toMatch(/SYN-1042|SYN-1086|Potassium|Hb 9\.8|Every 4 hours/);

  // Two days on, her doses count from her plan's schedule: the one she marked taken, and the ones she did not.
  const plan = await amelia.care.discharge(), later = new Date("2026-09-30T10:05:00+08:00");
  const azithromycin = plan.status === "discharged" ? plan.medicines.changed[0]! : undefined;
  await amelia.care.doses.take({ key: doseKey(azithromycin!.name, doseSlots(azithromycin!, new Date("2026-09-28T10:05:00+08:00"), later)[0]!) });
  const { text } = await recordText({ db, session: null, now: () => later, hospitalId: DEMO_HOSPITAL, patientId: "SYN-1042" });
  expect(text).toMatch(/\nDoses since going home: 1 of [2-9] due marked taken; not marked taken: .*(Azithromycin|Cetirizine) \w{3}, \d\d Sep 2026 \d\d:\d\d/);

  // The other patient, joined on his own account, reads his own rows and none of hers.
  const other = as("farid-account");
  await other.care.join({ code: (await doctor.care.code({ encounterId: "visit-1086" })).code });
  await other.care.ask({ question: "What were my blood results?" });
  const his = read[1]!;
  expect(his).toContain("- Potassium 3.1 mmol/L, low");
  expect(his).toContain("- Hb 9.8 g/dL, low");
  expect(his).not.toMatch(/Penicillin — reported rash|Asthma since childhood|CRP 48|Demam balik|Community-acquired pneumonia, mild/);
});

test("a call reads the same record as a typed question: recordText is what care.ask gives the model and what the call's chat carries", async () => {
  const read: string[] = [];
  const now = new Date("2026-09-28T10:05:00+08:00");
  const { amelia, db } = await world({ ...stubModels, answerFromPlan: async input => { read.push(input.plan); return { answer: "", grounded: false, urgent: false, source: "fixture" }; } });
  await amelia.care.ask({ question: "Bila temu janji saya?" });
  // The voice agents (apps/server/src/agents) call recordText with the patient their socket was signed in as, once a call.
  const spoken = await recordText({ db, session: null, now: () => now, hospitalId: DEMO_HOSPITAL, patientId: "SYN-1042" });
  expect(spoken.text).toBe(read[0]!);
  expect(spoken.text).toContain("Visits booked:");
  expect(spoken.text).toContain("Allergies: Penicillin — reported rash");
  expect(messagesFor({ question: "Bila temu janji saya?", history: [], plan: spoken.text, language: "ms" })[0]!.content).toEndWith(`Patient's record:\n${read[0]}\n\nHospital's general leaflets (advice for any patient, not facts about this patient):\nNone found for this question.`);
});

test("only an emergency sign reaches her care team from a typed question (founder, 9 Oct): a fever back is answered and tells no one; no check-in is used up", async () => {
  // The stub answers nothing, yet its keyword reader still flags the doctor.
  const { doctor, amelia } = await world();
  expect(await amelia.care.ask({ question: "Demam saya datang balik malam tadi, boleh makan ubat lagi?" })).not.toHaveProperty("careTeam");
  const urgent = await amelia.care.ask({ question: "I have chest pain since this morning" });
  expect(urgent.careTeam).toMatchObject({ title: "Amelia: chest pain after discharge", line: "I've let your care team know." });
  // The demo's day-2 words, typed: breathless (sesak nafas) is an emergency sign, so her care team hears of it in Malay.
  const breathless = await amelia.care.ask({ question: "Hello, Sona. Saya masih demam sikit, dan malam tadi saya rasa sesak nafas, inhaler pun tak berapa tolong." });
  expect(breathless.careTeam?.line).toBe("Saya sudah maklumkan pasukan penjagaan anda.");
  expect((await doctor.tasks.list()).filter(t => t.kind === "check-in").map(t => [t.id, t.title, t.owner, t.encounterId, t.completed])).toEqual([
    [urgent.careTeam!.taskId, "Amelia: chest pain after discharge", "Attending doctor", "visit-1042", false],
    [breathless.careTeam!.taskId, breathless.careTeam!.title, "Attending doctor", "visit-1042", false],
  ]);
  expect((await amelia.care.checkIns.list()).map(c => [c.day, c.sentAt, c.replies.length])).toEqual([[2, null, 0], [7, null, 0]]);
  // A plain question tells no one.
  expect(await amelia.care.ask({ question: "Bila saya makan ubat?" })).not.toHaveProperty("careTeam");
  expect((await doctor.tasks.list()).filter(t => t.kind === "check-in")).toHaveLength(2);
});

test("the model's own urgent flag reaches the care team when no keyword does; a failed report never fails the answer", async () => {
  const answerFromPlan: Models["answerFromPlan"] = async () => ({ answer: "Hubungi 999 sekarang.", grounded: false, urgent: true, source: "model", model: "gemma-test" });
  const { doctor, amelia } = await world({ ...stubModels, answerFromPlan, classifyReply: async () => ({ label: "urgent", symptom: "Confused", source: "model", model: "gemma-test" }) });
  const answer = await amelia.care.ask({ question: "Saya keliru, tak ingat di mana saya" });
  expect(answer).toMatchObject({ answer: "Hubungi 999 sekarang.", urgent: true, careTeam: { title: "Amelia: confused after discharge" } });
  expect((await doctor.tasks.list()).filter(t => t.kind === "check-in").map(t => t.id)).toEqual([answer.careTeam!.taskId]);

  const broken = await world({ ...stubModels, answerFromPlan, classifyReply: async () => { throw new Error("model down"); } });
  expect(await broken.amelia.care.ask({ question: "Sakit dada" })).toEqual({ answer: "Hubungi 999 sekarang.", grounded: false, urgent: true, sources: [], withheld: 0, source: "model", model: "gemma-test" });
});
