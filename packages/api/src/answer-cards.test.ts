import { DEMO_HOSPITAL } from "@sona-ai/db/demo";
import { doseLogs, encounters, labResults, observations, receipts } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { createTestDb } from "@sona-ai/db/testing";
import { partsOf, type AnswerCard } from "@sona-ai/domain/answer-parts";
import { doseKey } from "@sona-ai/domain/doses";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { bookCards, careCards, careLaneCards, cardsFor, doseCard, planMedicines, proCards, proLaneCards, readingCard, resultCard } from "./answer-cards";
import { patientPlan } from "./routers/care-plan";

const NOW = new Date("2026-09-28T10:05:00+08:00"), OUT = "2026-09-26T07:40:00.000Z"; // home since 15:40 on 26 Sep

/** Amelia home since 26 Sep (her plan: paracetamol, azithromycin, the salbutamol nebuliser stopped, cetirizine), with two results back. */
async function amelia() {
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T15:40:00+08:00"));
  await db.update(encounters).set({ state: { discharge: { glReceived: true, medsConfirmed: true, followUp: "2w", language: "ms", dischargedAt: OUT } } }).where(eq(encounters.id, "visit-1042"));
  await db.insert(labResults).values([
    { id: "lab-crp", patientId: "SYN-1042", test: "CRP", value: "86", unit: "mg/L", sourceId: "lab-crp", receivedAt: new Date("2026-09-27T08:00:00+08:00"), acknowledgedAt: NOW, acknowledgedBy: "dr-aisyah" },
    // Back from the lab, not yet seen by a doctor: she is not shown its value anywhere.
    { id: "lab-k", patientId: "SYN-1042", test: "Potassium", value: "2.9", unit: "mmol/L", flag: "critical low", sourceId: "lab-k", receivedAt: new Date("2026-09-28T09:00:00+08:00") },
  ]);
  const context = { db, session: null, hospitalId: DEMO_HOSPITAL, patientId: "SYN-1042", now: () => NOW };
  const plan = await patientPlan(context);
  return { db, context, plan };
}

test("cards come only from her rows: a medicine the model names that she does not take gives none, and each named row comes once, in the answer's order", async () => {
  const { context, plan } = await amelia();
  const marks = [
    { text: "Panadol", kind: "medicine" }, { text: "azithromycin", kind: "medicine" }, { text: "1 tablet", kind: "dose" },
    { text: "Azithromycin", kind: "medicine" }, { text: "salbutamol", kind: "medicine" },
  ] as const;
  const cards = await careCards(context, { plan, marks: [...marks], language: "en" });
  expect(cards).toEqual([
    { type: "medicine", name: "Azithromycin", dose: "1 tablet, with or without food", how: "Now a tablet once a day, for 2 more days", times: ["08:00"], source: "Your discharge plan" },
    { type: "medicine", name: "Salbutamol nebuliser", how: "Use your own inhaler instead, when you need it", note: "Stopped", source: "Your discharge plan" },
  ]);
  // In Malay, from the same plan: her words in her language, the name as written.
  const [malay] = await careCards(context, { plan, marks: [{ text: "Azithromycin", kind: "medicine" }], language: "ms" });
  expect(malay).toMatchObject({ name: "Azithromycin", how: "Kini sebiji tablet sehari, selama 2 hari lagi", source: "Pelan discaj anda" });
  // No marks (the stub, an old reply): no cards, and no rows read for them.
  expect(await careCards(context, { plan, language: "en" })).toEqual([]);
});

test("a result she may see is a card with its flag and range; one no doctor has acknowledged gives no card, however the answer names it", async () => {
  const { context, plan } = await amelia();
  const cards = await careCards(context, { plan, marks: [{ text: "potassium", kind: "test" }, { text: "CRP of 86", kind: "test" }], language: "en" });
  expect(cards).toEqual([{ type: "result", test: "CRP", value: "86", unit: "mg/L", flag: "high", range: "up to 5 mg/L", at: "2026-09-27T00:00:00.000Z", source: "Lab result" }]);
  // A clinician sees the same unacknowledged potassium on Daniel's visit, critical by the lab's call-now limit.
  expect(resultCard({ test: "Potassium", value: "2.9", unit: "mmol/L", flag: null, receivedAt: NOW }, "en").card).toMatchObject({ flag: "critical" });
});

test("a symptom on her come-back list brings the list, not when the answer is that list; an urgent turn puts the 999 card first; at most three", async () => {
  const { context, plan } = await amelia();
  const fever = [{ text: "fever", kind: "symptom" }] as const;
  const [soon] = await careCards(context, { plan, marks: [...fever], language: "en" });
  expect(soon).toEqual({ type: "warning", level: "soon", title: "Come back straight away if", items: ["Breathing gets harder", "Your lips or fingertips turn blue", "The fever comes back", "Chest pain, or you feel faint"] });
  expect(await careCards(context, { plan, marks: [...fever], from: "warning signs", language: "en" })).toEqual([]);
  // A cough is not on her list.
  expect(await careCards(context, { plan, marks: [{ text: "cough", kind: "symptom" }], language: "en" })).toEqual([]);
  const urgent = await careCards(context, { plan, urgent: true, marks: [{ text: "chest pain", kind: "warning" }, { text: "paracetamol", kind: "medicine" }, { text: "cetirizine", kind: "medicine" }, { text: "azithromycin", kind: "medicine" }], language: "zh" });
  expect(urgent.map(c => c.type === "warning" ? `${c.level} ${c.title}` : c.type)).toEqual(["urgent 请立即拨打999", "medicine", "medicine"]);
});

test("an answer from her visits shows the next one still to come (today's 15:55 visit has gone by)", async () => {
  const { context, plan } = await amelia();
  expect(await careCards(context, { plan, from: "follow-up", marks: [], language: "en" })).toEqual([{ type: "appointment", title: "Clinic review", when: "2026-10-10T07:40:00.000Z", status: "upcoming" }]);
});

test("Pro: a visit's prescriptions, results and ward readings as the lead names them; none off a visit", async () => {
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T15:40:00+08:00"));
  await db.insert(receipts).values({ id: "rx-1", kind: "prescription", encounterId: "visit-1086", requestId: "rx-1", revision: 1, approvedBy: "dr-aisyah", payload: { medication: "Potassium chloride", formulation: "tablet", dose: "600", unit: "mg", route: "oral", frequency: "twice daily", duration: "3 days" } });
  await db.insert(observations).values([37.2, 38.4].map((value, i) => ({ id: `t${i}`, patientId: "SYN-1086", kind: "temperature", value, unit: "°C", sourceId: `t${i}`, observedAt: new Date(NOW.getTime() + i * 3600_000) })));
  const context = { db, session: null, hospitalId: DEMO_HOSPITAL };
  const marks = [{ text: "low potassium of 3.1 mmol/L", kind: "warning" }, { text: "potassium chloride", kind: "medicine" }, { text: "temperature", kind: "test" }, { text: "furosemide", kind: "medicine" }] as const;
  const cards = await proCards(context, { encounterId: "visit-1086", marks: [...marks] });
  expect(cards.map(c => c.type)).toEqual(["result", "medicine", "reading"]);
  expect(cards[0]).toMatchObject({ test: "Potassium", value: "3.1", unit: "mmol/L", flag: "low", range: "3.5 to 5.1 mmol/L", source: "Lab result" });
  expect(cards[1]).toEqual({ type: "medicine", name: "Potassium chloride", dose: "600 mg tablet", how: "oral, twice daily, for 3 days", source: "Prescription" });
  expect(cards[2]).toEqual({ type: "reading", label: "Temperature", value: "38.4", unit: "°C", at: new Date(NOW.getTime() + 3600_000).toISOString() });
  expect(await proCards(context, { marks: [...marks] })).toEqual([]);
  expect(await proCards({ ...context, hospitalId: "other-hospital" }, { encounterId: "visit-1086", marks: [...marks] })).toEqual([]);
});

test("old answers still read, and a new one's cards reach a client through partsOf", () => {
  // An answer from before 11 Oct: no cards field, and the client shows none.
  expect(partsOf({ answer: "Take it after food.", grounded: true, marks: [{ text: "after food", kind: "when" }] })).toEqual({ marks: [{ text: "after food", kind: "dose" }] });
  const cards = cardsFor({ marks: [{ text: "paracetamol", kind: "medicine" }] }, { named: planMedicines({ new: [{ name: "Paracetamol", line: "x".repeat(400) }], changed: [], stopped: [], continue: [] }, "en") });
  // A plan line longer than a card allows is cut to fit, so the card is kept, not refused.
  expect(partsOf({ answer: "…", cards }).cards).toHaveLength(1);
  expect((cards[0] as Extract<AnswerCard, { type: "medicine" }>).how).toHaveLength(160);
});

test("fast-lane drafts: a visit request at a free time, the dose due now, a reading a person can show, a clinician's task", async () => {
  const lim = { id: "lim", name: "Dr. Lim Wei Jie", specialty: "Respiratory", room: "Clinic 3B", rating: 4.8, careTeam: true, nextSlots: [{ times: [new Date("2026-10-01T02:30:00Z"), new Date("2026-10-01T03:00:00Z")] }] };
  const [doctor, book] = bookCards([lim], { startsAt: new Date("2026-10-01T03:00:00Z"), reason: "still coughing" }, "en");
  expect(doctor).toMatchObject({ type: "doctor", id: "lim" });
  expect(book).toMatchObject({ type: "action", do: "book", title: "Visit with Dr. Lim Wei Jie", items: ["Thu 1 Oct at 11:00", "Clinic 3B"], payload: { doctorId: "lim", startsAt: "2026-10-01T03:00:00.000Z", reason: "still coughing" } });
  // A time that is not free gives the doctor's first free one.
  expect(bookCards([lim], { startsAt: new Date("2026-10-01T09:00:00Z") }, "ms")[1]).toMatchObject({ payload: { startsAt: "2026-10-01T02:30:00.000Z" }, confirm: "Hantar permintaan" });

  const azithro = { name: "Azithromycin", line: "Now a tablet once a day", take: "1 tablet", at: ["08:00"] };
  const due = doseCard([azithro], new Date(OUT), [], NOW, {}, "en");
  expect(due).toMatchObject([{ type: "action", do: "logDose", payload: { key: doseKey("Azithromycin", new Date("2026-09-28T08:00:00+08:00")) } }]);
  expect(doseCard([azithro], new Date(OUT), [doseKey("Azithromycin", new Date("2026-09-28T08:00:00+08:00"))], NOW, {}, "en")).toEqual([]);
  expect(doseCard([azithro], new Date(OUT), [], NOW, { medicine: "cetirizine" }, "en")).toEqual([]);

  expect(readingCard({ kind: "blood_pressure", value: 130, value2: 85 }, "en")).toMatchObject([{ do: "logReading", title: "Blood pressure 130/85 mmHg", payload: { kind: "blood_pressure", value: 130, value2: 85 } }]);
  expect(readingCard({ kind: "blood_pressure", value: 130 }, "en")).toEqual([]);
  expect(readingCard({ kind: "temperature", value: 98.6 }, "en")).toEqual([]); // Fahrenheit is not a °C a person shows

  const task = proLaneCards({ intent: "create_task", said: { task: { encounterId: "visit-1086", title: "Repeat potassium tomorrow", owner: "Nurse", due: "2026-09-29" } } });
  expect(task).toMatchObject([{ do: "createTask", payload: { encounterId: "visit-1086", title: "Repeat potassium tomorrow", owner: "Nurse", due: "2026-09-29" } }]);
  expect(proLaneCards({ intent: "ward_overview" })).toEqual([]);
});

test("Care fast-lane cards read her own rows: her next visits, the dose due now", async () => {
  const { db, context } = await amelia();
  expect(await careLaneCards(context, { intent: "next_appointment", language: "en" })).toEqual([{ type: "appointment", title: "Clinic review", when: "2026-10-10T07:40:00.000Z", status: "upcoming" }]);
  const [dose] = await careLaneCards(context, { intent: "log_dose", language: "en" });
  expect(dose).toMatchObject({ do: "logDose", payload: { key: doseKey("Azithromycin", new Date("2026-09-28T08:00:00+08:00")) } });
  await db.insert(doseLogs).values({ id: "d1", hospitalId: DEMO_HOSPITAL, patientId: "SYN-1042", key: doseKey("Azithromycin", new Date("2026-09-28T08:00:00+08:00")), takenAt: NOW });
  expect(await careLaneCards(context, { intent: "log_dose", language: "en" })).toEqual([]);
  expect(await careLaneCards(context, { intent: "log_reading", said: { reading: { kind: "heart_rate", value: 72 } }, language: "en" })).toMatchObject([{ do: "logReading" }]);
  // Her home blood pressure, once she has logged one, is a reading card when an answer names it.
  await db.insert(observations).values([
    { id: "bp1", patientId: "SYN-1042", kind: "blood_pressure", value: 128, unit: "mmHg", sourceId: "sona-care", source: "patient", observedAt: NOW },
    { id: "bp1-d", patientId: "SYN-1042", kind: "blood_pressure_diastolic", value: 82, unit: "mmHg", sourceId: "sona-care", source: "patient", observedAt: NOW },
  ]);
  const plan = await patientPlan(context);
  expect(await careCards(context, { plan, marks: [{ text: "tekanan darah", kind: "test" }], language: "ms" })).toEqual([{ type: "reading", label: "Tekanan darah", value: "128/82", unit: "mmHg", at: NOW.toISOString() }]);
});
