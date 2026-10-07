import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { claimChecks } from "@sona-ai/domain/claim";
import { dischargeChecks, planFor } from "@sona-ai/domain/discharge";
import { defaultMedications } from "@sona-ai/domain/prescribing";
import type { Patient } from "@sona-ai/domain/types";
import { account, admissions, appointments, careLinks, casemixWeights, encounters, followUpRules, guaranteeLetters, hospitalMembers, insurerCriteria, labResults, notes, observations, patients, user } from "./schema";
import { DEMO_CLINICIANS } from "./demo";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { DEMO_HOSPITAL, LEGACY_EMAILS, seedDemo, seedDemoNote, seedTestPatient, seedTestStaff, TEST_BED_MANAGER, TEST_DOCTOR, TEST_DOCTOR_2, TEST_MANAGER, TEST_NURSE, TEST_NURSE_2, TEST_PATIENT, WARD_EXTRA } from "./seed";
import { createTestDb } from "./testing";

test("the Sona Care test patient is seeded signed up and linked to Amelia, rerun-safe, and takes the demo phone back from a stray account", async () => {
  const db = await createTestDb();
  await seedDemo(db);
  await db.insert(user).values({ id: "stray", name: "stray", email: "stray@phone.sona.invalid", phoneNumber: TEST_PATIENT.phone, phoneNumberVerified: true });
  const id = await seedTestPatient(db);
  expect(await seedTestPatient(db)).toBe(id);
  expect((await db.select().from(user).where(eq(user.phoneNumber, TEST_PATIENT.phone))).map(u => [u.id, u.email, u.phoneNumberVerified])).toEqual([[id, TEST_PATIENT.email, true]]);
  expect((await db.select().from(account).where(eq(account.userId, id))).map(a => a.providerId)).toEqual(["credential"]);
  expect(await db.select().from(careLinks).where(eq(careLinks.userId, id))).toMatchObject([{ hospitalId: DEMO_HOSPITAL, patientId: "SYN-1042" }]);
});

const STAFF = [TEST_DOCTOR, TEST_NURSE, TEST_BED_MANAGER, TEST_MANAGER, TEST_DOCTOR_2, TEST_NURSE_2];

test("every test clinician is seeded signed up and already a member of the demo hospital, rerun-safe, so a handover has a receiver", async () => {
  const db = await createTestDb();
  await seedDemo(db);
  await seedTestStaff(db);
  await seedTestStaff(db);
  const staff = await db.select({ name: user.name, email: user.email, role: hospitalMembers.role, hospitalId: hospitalMembers.hospitalId })
    .from(hospitalMembers).innerJoin(user, eq(user.id, hospitalMembers.userId));
  const byEmail = (a: { email: string }, b: { email: string }) => a.email < b.email ? -1 : 1;
  expect(staff.sort(byEmail)).toEqual([...STAFF].sort(byEmail).map(({ name, email, role }) => ({ name, email, role, hospitalId: DEMO_HOSPITAL })));
  expect((await db.select().from(account)).map(a => [a.userId, a.providerId]).sort()).toEqual(STAFF.map(s => [s.id, "credential"]).sort());
});

test("a staff account signed up under its legacy email is renamed to the demo username and its password reset to the slide's, keeping its rows", async () => {
  const db = await createTestDb();
  await seedDemo(db);
  await db.insert(user).values({ id: "signed-up-on-staging", name: "Aisyah", email: LEGACY_EMAILS[TEST_DOCTOR.email]! });
  await db.insert(account).values({ id: "their-login", accountId: "signed-up-on-staging", providerId: "credential", userId: "signed-up-on-staging", password: await hashPassword("something-else") });
  await seedTestStaff(db);
  const [doctor] = await db.select().from(user).where(eq(user.email, TEST_DOCTOR.email));
  expect(doctor?.id).toBe("signed-up-on-staging");
  expect(await db.select().from(user).where(eq(user.id, TEST_DOCTOR.id))).toEqual([]);
  const [login] = await db.select().from(account).where(eq(account.userId, "signed-up-on-staging"));
  expect(login?.id).toBe("their-login");
  expect(await verifyPassword({ hash: login!.password!, password: TEST_DOCTOR.password })).toBe(true);
});

test("each synthetic test clinician joins the demo hospital with its own role", () => {
  expect([TEST_DOCTOR, TEST_NURSE, TEST_BED_MANAGER, TEST_MANAGER].map(a => DEMO_CLINICIANS[a.email])).toEqual(["doctor", "nurse", "bed-manager", "management"]);
});

test("the demo seed has the two visit patients and Amelia in bed 6 awaiting her final GL", async () => {
  const db = await createTestDb();
  await seedDemo(db);
  await seedDemo(db); // seeding twice is harmless
  const rows = await db.select().from(patients).where(eq(patients.hospitalId, DEMO_HOSPITAL));
  expect(rows.map(p => p.name).sort()).toEqual(["Amelia Tan", "Chong Mei Yee", "Daniel Rahman", "Dayang Suhaila", "Ganesan Muthu", "Hafizah Yusof", "Harjit Singh", "Jimmy Anak Sali",
    "Lim Wei Jie", "Nurul Huda", "Priya Nair", "Ravi Kumar", "Rosnah Ismail", "Siti Aminah", "Suresh Pillai", "Tan Ah Kow", "Wong Siew Ling"]);
  const [bed] = await db.select().from(admissions).where(eq(admissions.patientId, "SYN-1042"));
  expect(bed?.bed).toBe("Bed 6");
  const [gl] = await db.select().from(guaranteeLetters).where(eq(guaranteeLetters.admissionId, bed!.id));
  expect(gl?.status).toBe("requested");
});

test("the rest of the ward is seeded as rows its blockers derive from: a GL, pending results, discharge state and a ride", async () => {
  const db = await createTestDb();
  const now = new Date("2026-09-26T09:00:00+08:00");
  await seedDemo(db, now);
  await seedDemo(db, now);
  const beds = await db.select().from(admissions).where(eq(admissions.hospitalId, DEMO_HOSPITAL));
  const fixtureBeds = ["Bed 12", "Bed 14", "Bed 2", "Bed 4", "Bed 6", "Bed 8", "Bed 9"];
  expect(beds.filter(a => fixtureBeds.includes(a.bed)).map(a => [a.bed, a.patientId]).sort()).toEqual([
    ["Bed 12", "SYN-2012"], ["Bed 14", "SYN-2014"], ["Bed 2", "SYN-2002"], ["Bed 4", "SYN-2004"], ["Bed 6", "SYN-1042"], ["Bed 8", "SYN-2008"], ["Bed 9", "SYN-2009"],
  ]);
  // Fit beds carry the time they became fit; Nurul has waited five hours.
  expect(beds.find(a => a.bed === "Bed 2")?.fitAt?.toISOString()).toBe("2026-09-25T20:00:00.000Z"); // 04:00 local, five hours before 09:00
  expect(beds.find(a => a.bed === "Bed 12")?.fitAt).toBeNull();
  expect((await db.select().from(guaranteeLetters)).map(g => [g.admissionId, g.status]).sort()).toEqual([["adm-1042", "requested"], ["adm-2002", "requested"]]);
  const pending = await db.select().from(labResults).where(eq(labResults.flag, "pending"));
  expect(pending.map(r => [r.patientId, r.test]).sort()).toEqual([["SYN-2002", "Urine culture sensitivities"], ["SYN-2009", "Renal function"], ["SYN-2017", "Repeat haemoglobin"]]);
  const [lim] = await db.select().from(encounters).where(eq(encounters.patientId, "SYN-2014"));
  expect(lim?.state).toEqual({ discharge: { medsConfirmed: false, followUp: "2w" }, transport: { label: "Ride home", detail: "Family free after 17:00" } });
  const [nurul] = await db.select().from(patients).where(eq(patients.id, "SYN-2002"));
  expect(nurul).toMatchObject({ initials: "NH", age: 29, sex: "Female", record: { ward: { status: "fit", predicted: "11:00", waitingHours: 5 } } });
});

test("the connected ward is 16 fictional patients as real rows, one per bed, each with a visit and a ward record, and adds no blocked bed", async () => {
  const db = await createTestDb();
  const now = new Date("2026-09-26T09:00:00+08:00");
  await seedDemo(db, now);
  await seedDemo(db, now);
  const beds = await db.select().from(admissions).where(eq(admissions.hospitalId, DEMO_HOSPITAL));
  expect(beds).toHaveLength(16);
  expect(new Set(beds.map(a => a.bed)).size).toBe(16);
  // Bed 10 stays the ward's one empty bed.
  expect(beds.some(a => a.bed === "Bed 10")).toBe(false);
  const people = await db.select().from(patients).where(eq(patients.hospitalId, DEMO_HOSPITAL));
  const visits = await db.select().from(encounters).where(eq(encounters.hospitalId, DEMO_HOSPITAL));
  for (const bed of WARD_EXTRA) {
    const admission = beds.find(a => a.bed === bed.bed)!;
    expect(admission.patientId).toBe(`SYN-20${bed.bed.replace("Bed ", "").padStart(2, "0")}`);
    const person = people.find(p => p.id === admission.patientId)!;
    expect(person).toMatchObject({ name: bed.name, initials: bed.initials, complaint: bed.sbar!.s, record: { ward: { status: bed.status, sbar: bed.sbar } } });
    expect(`${person.age} · ${person.sex}`).toBe(bed.meta!);
    expect(visits.filter(v => v.patientId === person.id)).toHaveLength(1);
    // Only a fit bed carries the time it became fit; nothing here holds a discharge (no GL, no medicines to dispense).
    expect(Boolean(admission.fitAt)).toBe(bed.status === "fit");
    expect(bed.blockers.filter(x => x.kind === "gl" || x.kind === "pharmacy")).toEqual([]);
  }
  expect(new Set(WARD_EXTRA.map(b => b.status))).toEqual(new Set(["fit", "watch", "stable"]));
  // Dayang is fit with her medicines confirmed and a follow-up chosen, so her bed reads ready, not blocked.
  expect(visits.find(v => v.patientId === "SYN-2007")?.state).toEqual({ discharge: { medsConfirmed: true, followUp: "2w" } });
  expect(visits.find(v => v.patientId === "SYN-2015")?.state).toEqual({ transport: { label: "Transfer to cardiac centre", detail: "Waiting for a slot" } });
});

test("the chart holds Amelia's CURB-65 readings and Daniel's low potassium, each with a source", async () => {
  const db = await createTestDb();
  await seedDemo(db);
  await seedDemo(db);
  const obs = await db.select().from(observations).where(eq(observations.patientId, "SYN-1042"));
  expect(Object.fromEntries(obs.map(o => [o.kind, `${o.value} ${o.unit}`]))).toEqual({
    confusion: "10 AMT", urea: "5.1 mmol/L", "respiratory-rate": "18 /min", systolic: "124 mmHg", diastolic: "78 mmHg",
    // This morning's chart: afebrile, as her ward record says.
    temperature: "36.9 °C", pulse: "84 bpm", "oxygen-saturation": "97 %",
  });
  expect(obs.every(o => o.sourceId)).toBe(true);
  const [k] = await db.select().from(labResults).where(eq(labResults.id, "lab-1086-potassium"));
  expect(k).toMatchObject({ patientId: "SYN-1086", test: "Potassium", value: "3.1", unit: "mmol/L", flag: "low" });
  expect(k?.sourceId).toBeTruthy();
});

test("every admitted patient has a whole fictional record in the real tables: history, medicines, this morning's chart, a saved note, sources that say they are fictional", async () => {
  const db = await createTestDb();
  const now = new Date("2026-09-26T09:00:00+08:00");
  await seedDemo(db, now);
  await seedDemo(db, new Date(now.getTime() + 3600_000)); // a later reseed moves the chart with the clock and adds nothing
  const people = await db.select().from(patients).where(eq(patients.hospitalId, DEMO_HOSPITAL));
  const chart = await db.select().from(observations), saved = await db.select().from(notes), visits = await db.select().from(encounters);
  const admitted = people.filter(p => p.id.startsWith("SYN-20"));
  expect(admitted).toHaveLength(15);
  for (const p of admitted) {
    const record = p.record as Pick<Patient, "history" | "family" | "social" | "medicines" | "vitals" | "sources" | "subtitle">;
    expect(record.history.length).toBeGreaterThanOrEqual(2);
    expect([record.family, record.social, record.subtitle].every(Boolean)).toBe(true);
    expect(record.medicines).toBeArray();
    expect(record.vitals.map(v => v.label)).toEqual(["SpO₂", "Temp", "Pulse"]);
    expect(record.sources.map(s => [s.id, s.kind, s.synthetic, s.excerpt.startsWith("Fictional")])).toEqual([["history", "record", true, true], ["vitals", "record", true, true]]);
    // One row per reading, two hours before the latest seed, agreeing with the record's vitals.
    const obs = chart.filter(o => o.patientId === p.id);
    expect(obs.map(o => o.kind).sort()).toEqual(["diastolic", "oxygen-saturation", "pulse", "respiratory-rate", "systolic", "temperature"]);
    expect(obs.every(o => o.observedAt.toISOString() === "2026-09-26T00:00:00.000Z" && o.sourceId === o.id)).toBe(true);
    expect(record.vitals[1]!.value).toBe(`${obs.find(o => o.kind === "temperature")!.value} °C`);
    // The visit's note, in the shape note.save writes: one sentence per section.
    const visit = visits.find(v => v.patientId === p.id)!;
    expect(saved.filter(n => n.encounterId === visit.id).map(n => [n.id, n.revision, n.sentences.map(s => s.id)])).toEqual([[`note-${visit.id}-1`, 1, ["subjective", "objective", "assessment", "plan"]]]);
  }
  // No transcript is listed as a source of anyone's record: no recording of a visit is saved.
  expect(people.flatMap(p => (p.record as Pick<Patient, "sources">).sources ?? []).filter(s => s.kind === "transcript")).toEqual([]);
  expect((people.find(p => p.id === "SYN-1042")!.record as { visit?: unknown }).visit).toBeUndefined();
  // Recorded allergies are the patient's own; no row claims "none".
  expect(Object.fromEntries(people.filter(p => p.allergies).map(p => [p.name, p.allergies!.split(" — ")[0]]))).toEqual({
    "Amelia Tan": "Penicillin", "Priya Nair": "Penicillin", "Ravi Kumar": "Perindopril", "Dayang Suhaila": "Aspirin", "Wong Siew Ling": "Co-trimoxazole", "Chong Mei Yee": "Codeine",
  });
});

test("a take-home list is charted only for a bed that is fit to go, and the plan, the checks and a claim's criteria read the seeded rows", async () => {
  const db = await createTestDb();
  const now = new Date("2026-09-26T09:00:00+08:00");
  await seedDemo(db, now);
  const people = await db.select().from(patients).where(eq(patients.hospitalId, DEMO_HOSPITAL));
  type Record = Parameters<typeof planFor>[0] & { ward?: { status: string } };
  for (const p of people) expect([p.name, Boolean((p.record as Record).takeHome)]).toEqual([p.name, (p.record as Record).ward?.status === "fit"]);
  const meds = (id: string) => planFor(people.find(p => p.id === id)!.record as Record).meds.map(m => [m.name, m.change]);
  expect(meds("SYN-1042")).toEqual([["Azithromycin", "changed"], ["Paracetamol", "new"], ["Nebulised salbutamol", "stopped"], ["Cetirizine", "unchanged"]]);
  expect(meds("SYN-2008")).toEqual([["Clindamycin", "changed"], ["Paracetamol", "new"], ["Metformin", "unchanged"]]);
  // Not yet fit: the medicines taken before admission carry on until the ward charts a list.
  expect(meds("SYN-2009")).toEqual([["Furosemide 40 mg", "unchanged"], ["Bisoprolol 2.5 mg", "unchanged"], ["Losartan 50 mg", "unchanged"]]);
  // Amelia's chart passes the observations check from her own rows.
  const vitals = (await db.select().from(observations).where(eq(observations.patientId, "SYN-1042"))).map(o => ({ kind: o.kind, value: o.value, unit: o.unit, at: o.observedAt.toISOString() }));
  expect(dischargeChecks({ glReceived: false, medsConfirmed: false, language: "ms" }, planFor({ ...people.find(p => p.id === "SYN-1042")!.record as Record, visit: { vitals } })).find(c => c.id === "observations")?.status).toBe("passed");
  // The two stays waiting on a guarantee letter. Nurul's note meets the insurer's criteria but one: it says IV, not why.
  // Amelia's visit has no note in seedDemo alone. seedDemoNote adds her one saved note, however often it runs: it says her
  // score and her film; the organism and why IV came first are left for the doctor, never answered by the seed.
  expect(await db.select().from(notes).where(eq(notes.encounterId, "visit-1042"))).toEqual([]);
  await seedDemoNote(db);
  await seedDemoNote(db);
  const note = async (visit: string) => (await db.select().from(notes).where(eq(notes.encounterId, visit)))[0]?.sentences ?? [];
  expect(claimChecks(await note("visit-2002")).map(c => [c.id, c.status])).toEqual([["severity", "passed"], ["imaging", "passed"], ["iv", "blocked"]]);
  expect((await db.select().from(notes).where(eq(notes.encounterId, "visit-1042"))).map(n => [n.id, n.revision, n.sentences.map(s => s.id)])).toEqual([["note-visit-1042-1", 1, ["subjective", "objective", "assessment", "plan"]]]);
  expect(claimChecks(await note("visit-1042")).map(c => [c.id, c.status])).toEqual([["severity", "passed"], ["imaging", "passed"], ["organism", "blocked"], ["iv", "blocked"]]);
  // Her cetirizine is recorded with its form, so the medicine resolves without a guess.
  expect(defaultMedications({ medicines: (people.find(p => p.id === "SYN-1042")!.record as Pick<Patient, "medicines">).medicines } as Patient).map(m => [m.ingredient, m.formulation])).toEqual([["salbutamol", "inhaler"], ["cetirizine", "tablet"]]);
});

test("the demo insurer's criteria for Amelia's claim are rows, the organism rule tied to J18.9", async () => {
  const db = await createTestDb();
  await seedDemo(db);
  await seedDemo(db);
  const rows = await db.select().from(insurerCriteria).where(eq(insurerCriteria.insurer, "Synthetic insurer"));
  expect(rows.map(r => r.label).sort()).toEqual([
    "Imaging result attached", "Organism documented", "Reason for IV antibiotics", "Severity score documented", "Stay within the approved plan",
  ]);
  expect(rows.find(r => r.label === "Organism documented")?.code).toBe("J18.9");
});

test("every coding-audit code has a casemix weight, and each audit's specific code weighs more than the vague one", async () => {
  const db = await createTestDb();
  await seedDemo(db);
  await seedDemo(db);
  const w = Object.fromEntries((await db.select().from(casemixWeights)).map(r => [r.code, r.weight]));
  const pairs = [["K35.8", "K35.3"], ["I50.9", "I50.0"], ["I64", "I63.9"], ["L03.9", "L03.1"], ["J44.9", "J44.1"], ["A41.9", "A41.5"], ["J45.9", "J46"]] as const;
  for (const [vague, specific] of pairs) expect(w[specific]!).toBeGreaterThan(w[vague]!);
  for (const code of ["J18.9", "N10", "D64.9", "E87.1", "N17.9"]) expect(w[code]).toBeGreaterThan(0);
});

test("both visit patients have one appointment today, still today when seeded again on a later day", async () => {
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-25T09:00:00+08:00"));
  await seedDemo(db, new Date("2026-09-26T09:00:00+08:00"));
  const rows = await db.select().from(appointments).orderBy(appointments.startsAt);
  expect(rows.map(r => [r.patientId, r.startsAt.toISOString()])).toEqual([
    ["SYN-1042", "2026-09-26T01:15:00.000Z"],
    ["SYN-1086", "2026-09-26T01:45:00.000Z"],
  ]);
});

test("follow-up rules are rows: a nodule over 8 mm is due in 3 months, one under 6 mm needs no routine follow-up", async () => {
  const db = await createTestDb();
  await seedDemo(db);
  const rules = await db.select().from(followUpRules);
  const byId = Object.fromEntries(rules.map(r => [r.id, r]));
  expect(byId["nodule-over-8"]).toMatchObject({ kind: "nodule", riskBand: "high", minMm: 8.1, intervalDays: 90, action: "CT chest at 3 months, PET-CT or tissue sampling" });
  expect(byId["nodule-under-6"]).toMatchObject({ riskBand: "low", intervalDays: null });
  expect(byId["cardiomegaly-borderline"]).toMatchObject({ minMm: null, intervalDays: 42, action: "Echocardiogram" });
});
