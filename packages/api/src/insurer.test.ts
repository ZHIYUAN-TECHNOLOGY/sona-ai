import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { admissions, claims, guaranteeLetters } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { EMPTY_CLAIM, ORGANISM_UNKNOWN, ivReason, noteFor } from "@sona-ai/domain/claim";
import { eq } from "drizzle-orm";

import type { Context, Mail } from "./context";
import { stubModels, type Models } from "./models";
import { decideReview, renderReviewPage, reviewPacket, reviewTokenOf } from "./insurer";
import { appRouter } from "./routers/index";

const session = {
  user: { id: "dr-aisyah", name: "Dr Aisyah", email: "aisyah@demo.test", emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: "s1", userId: "dr-aisyah", token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session;
const sent: Parameters<Mail["send"]>[0][] = [];
const mail = (fail = false): Mail => ({ from: "sona@mail.demo.test", insurer: "desk@insurer.test", send: async m => { if (fail) throw new Error("domain not onboarded"); sent.push(m); } });

/** Amelia's consultation note as saved, with both fixes written into it, so the insurer's criteria are all met by the note itself. */
const NOTE = [...noteFor(EMPTY_CLAIM), ORGANISM_UNKNOWN, ivReason("vomiting on arrival, unable to keep oral tablets down.")];

/** Amelia's claim, documented and sent, as the app sends it. */
async function sentClaim(extra: Partial<Context> = {}) {
  sent.length = 0;
  const db = await createTestDb();
  await seedDemo(db);
  await addClinician(db, "dr-aisyah");
  const clock = { now: new Date("2026-09-26T10:00:00+08:00") };
  const api = createRouterClient(appRouter, { context: { db, session, now: () => clock.now, publicUrl: "https://sona.test", ...extra } });
  await api.note.save({ encounterId: "visit-1042", expectedRevision: 0, sentences: NOTE });
  await api.claim.send({ encounterId: "visit-1042", requestId: "c1", approvedBy: "dr-aisyah" });
  return { db, api, clock, token: await reviewTokenOf(db, "visit-1042") };
}

test("sending a claim creates a review link; the page shows the packet: patient, each code with its note sentence, and the criteria as the note meets them, with no amount nobody recorded", async () => {
  const { db, api, clock, token } = await sentClaim();
  expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
  const status = await api.claim.status({ encounterId: "visit-1042" });
  expect(status).toMatchObject({ status: "sent", reviewUrl: `https://sona.test/insurer/${token}` });
  const packet = (await reviewPacket(db, token, clock.now))!;
  expect(packet).toMatchObject({ patient: "Amelia Tan", insurer: "Synthetic insurer", estimate: undefined, status: "sent" });
  expect((await db.select().from(claims))[0]!.estimateCents).toBe(0);
  expect(renderReviewPage(packet)).not.toContain("estimated");
  expect(packet.codes.find(c => c.code === "J18.9")).toMatchObject({ label: "Pneumonia, unspecified organism", evidence: "Community-acquired pneumonia, CURB-65 0." });
  // Each criterion quotes the sentence of her note that meets it.
  expect(packet.criteria.map(c => [c.id, c.status, c.detail])).toEqual([
    ["severity", "passed", "“Community-acquired pneumonia, CURB-65 0.”"], ["imaging", "passed", "“Chest film: right lower zone consolidation.”"],
    ["organism", "passed", "“Organism not identified.”"], ["iv", "passed", "“IV first: vomiting on arrival, unable to keep oral tablets down.”"],
  ]);
  expect(await reviewPacket(db, "not-a-token", clock.now)).toBeUndefined();
});

test("the insurer approves: the claim is approved, the guarantee letter received, and a second decision changes nothing", async () => {
  const { db, api, clock, token } = await sentClaim();
  clock.now = new Date(clock.now.getTime() + 5 * 60_000);
  expect(await decideReview(db, token, "approve", "", clock.now)).toEqual({ ok: true, status: "approved", hospitalId: "demo", encounterId: "visit-1042" });
  expect(await api.claim.status({ encounterId: "visit-1042" })).toMatchObject({ status: "approved", approvedAt: clock.now.toISOString() });
  expect((await db.select().from(guaranteeLetters).where(eq(guaranteeLetters.id, "gl-1042")))[0]).toMatchObject({ status: "received" });
  expect(await decideReview(db, token, "query", "Why IV?", clock.now)).toEqual({ ok: false, reason: "Already decided: approved" });
});

test("the insurer queries: the claim shows their question, the letter stays outstanding, and an expired link cannot decide", async () => {
  const { db, api, clock, token } = await sentClaim();
  expect(await decideReview(db, token, "query", "  ", clock.now)).toEqual({ ok: false, reason: "Write the question for the doctor" });
  expect(await decideReview(db, token, "query", "Please attach the sputum culture request.", clock.now)).toMatchObject({ ok: true, status: "queried", encounterId: "visit-1042" });
  expect(await api.claim.status({ encounterId: "visit-1042" })).toMatchObject({ status: "queried", query: "Please attach the sputum culture request." });
  expect((await db.select().from(guaranteeLetters).where(eq(guaranteeLetters.id, "gl-1042")))[0]).toMatchObject({ status: "requested" });
  const other = await sentClaim();
  expect(await decideReview(other.db, other.token, "approve", "", new Date(other.clock.now.getTime() + 8 * 24 * 3600_000))).toEqual({ ok: false, reason: "This link has expired" });
});

test("the review link is emailed to the insurer's inbox; a failed email never fails the send, and with no mail configured nothing is sent", async () => {
  const { token } = await sentClaim({ mail: mail() });
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ from: "sona@mail.demo.test", to: "desk@insurer.test", subject: "Final guarantee letter · Amelia Tan (synthetic)" });
  expect(sent[0]!.text).toContain(`https://sona.test/insurer/${token}`);
  const failed = await sentClaim({ mail: mail(true) });
  expect(await failed.api.claim.status({ encounterId: "visit-1042" })).toMatchObject({ status: "sent" });
  await sentClaim();
  expect(sent).toHaveLength(0);
});

test("the review page escapes what it shows and offers approve and query only while undecided", async () => {
  const { db, clock, token } = await sentClaim();
  const packet = (await reviewPacket(db, token, clock.now))!;
  const html = renderReviewPage({ ...packet, patient: "<script>alert(1)</script>" });
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain('value="approve"');
  expect(html).toContain('value="query"');
  await decideReview(db, token, "approve", "", clock.now);
  const decided = renderReviewPage((await reviewPacket(db, token, clock.now))!);
  expect(decided).not.toContain('value="approve"');
  expect(decided).toContain("Approved");
});

test("the letter carries the codes the doctor reviewed for this patient, not the demo patient's authored ones", async () => {
  const models: Models = { ...stubModels, suggestCodes: async () => ({ source: "model", model: "test", codes: [{ code: "J15.9", label: "Bacterial pneumonia, unspecified", kind: "Principal", evidence: "diagnosis" }] }) };
  const db = await createTestDb();
  await seedDemo(db);
  await addClinician(db, "dr-aisyah");
  const clock = { now: new Date("2026-09-26T10:00:00+08:00") };
  const api = createRouterClient(appRouter, { context: { db, session, now: () => clock.now, models } });
  await api.note.save({ encounterId: "visit-1042", expectedRevision: 0, sentences: NOTE });
  await api.claim.suggestCodes({ encounterId: "visit-1042" });
  await api.claim.send({ encounterId: "visit-1042", requestId: "c-own", approvedBy: "dr-aisyah" });

  expect((await db.select().from(claims))[0]!.codes.map(c => c.code)).toEqual(["J15.9"]);
  const packet = (await reviewPacket(db, await reviewTokenOf(db, "visit-1042"), clock.now))!;
  expect(packet.codes).toEqual([{ code: "J15.9", label: "Bacterial pneumonia, unspecified", kind: "Principal", evidence: "Community-acquired pneumonia, CURB-65 0." }]);
});

test("a send after the insurer approved returns the one receipt: no second email, and the link stays the same", async () => {
  const { db, api, clock, token } = await sentClaim({ mail: mail() });
  const [first] = await db.select().from(claims);
  await decideReview(db, token, "approve", "", clock.now);
  const again = await api.claim.send({ encounterId: "visit-1042", requestId: "c-late", approvedBy: "dr-aisyah" });
  expect(again.requestId).toBe("c1");
  expect(sent).toHaveLength(1);
  expect((await db.select().from(claims))[0]).toMatchObject({ status: "approved", reviewToken: first!.reviewToken });
});

test("the insurer denies with a listed reason; the doctor appeals with a draft grounded in the note; the insurer approves the appeal", async () => {
  const { db, api, clock, token } = await sentClaim();
  expect(await api.claim.appealDraft({ encounterId: "visit-1042" }).catch(e => e.code)).toBe("PRECONDITION_FAILED");
  expect(await decideReview(db, token, "deny", "", clock.now, "made-up")).toEqual({ ok: false, reason: "Choose the reason for the denial" });
  expect(await decideReview(db, token, "deny", "Culture result missing.", clock.now, "DOC")).toMatchObject({ ok: true, status: "denied", encounterId: "visit-1042" });
  expect(renderReviewPage((await reviewPacket(db, token, clock.now))!)).toContain("Denied: Documentation incomplete: organism / severity not stated");
  expect(await api.claim.status({ encounterId: "visit-1042" })).toMatchObject({ status: "denied", reviewUrl: undefined,
    denial: { code: "DOC", reason: "Documentation incomplete: organism / severity not stated", note: "Culture result missing.", at: clock.now.toISOString() } });

  // The draft: a labelled sample whose every point cites a sentence of this patient's note.
  const draft = await api.claim.appealDraft({ encounterId: "visit-1042" });
  expect(draft.source).toBe("fixture");
  expect(draft.letter.points.map(p => p.evidenceSentenceId)).toEqual(["organism", "diagnosis", "xray"]);
  expect(draft.sentences.find(s => s.id === "organism")?.text).toBe("Organism not identified.");

  // A point citing nothing in the note is refused; the doctor's edited letter goes, once per requestId, with a fresh link.
  const letter = { ...draft.letter, opening: "Edited by the doctor." };
  const bad = { ...letter, points: [{ claim: "Made up", evidenceSentenceId: "nowhere" }] };
  expect(await api.claim.appeal({ encounterId: "visit-1042", requestId: "a0", approvedBy: "dr-aisyah", letter: bad }).catch(e => e.code)).toBe("BAD_REQUEST");
  const receipt = await api.claim.appeal({ encounterId: "visit-1042", requestId: "a1", approvedBy: "dr-aisyah", letter });
  expect(receipt).toMatchObject({ kind: "appeal", requestId: "a1" });
  expect((await api.claim.appeal({ encounterId: "visit-1042", requestId: "a1", approvedBy: "dr-aisyah", letter })).id).toBe(receipt.id);
  expect(await api.claim.appeal({ encounterId: "visit-1042", requestId: "a2", approvedBy: "dr-aisyah", letter }).catch(e => e.code)).toBe("PRECONDITION_FAILED");
  const fresh = await reviewTokenOf(db, "visit-1042");
  expect(fresh).not.toBe(token);
  expect(await api.claim.status({ encounterId: "visit-1042" })).toMatchObject({ status: "appealed", reviewUrl: `https://sona.test/insurer/${fresh}`, appealedAt: clock.now.toISOString(), denial: { code: "DOC" } });

  // The insurer sees the appeal (with the sentences it cites) above the three decisions, and approves.
  const page = renderReviewPage((await reviewPacket(db, fresh, clock.now))!);
  expect(page).toContain("Appeal from the hospital");
  expect(page).toContain("Edited by the doctor.");
  expect(page).toContain("From the note: “Organism not identified.”");
  for (const decision of ['value="approve"', 'value="query"', 'value="deny"']) expect(page).toContain(decision);
  expect(await decideReview(db, token, "approve", "", clock.now)).toEqual({ ok: false, reason: "Unknown link" });
  expect(await decideReview(db, fresh, "approve", "", clock.now)).toMatchObject({ ok: true, status: "approved" });
  expect((await db.select().from(guaranteeLetters).where(eq(guaranteeLetters.id, "gl-1042")))[0]).toMatchObject({ status: "received" });
});

test("approval marks only the current admission's guarantee letter received, not an earlier stay's", async () => {
  const { db, clock, token } = await sentClaim();
  await db.insert(admissions).values({ id: "adm-1042-earlier", patientId: "SYN-1042", hospitalId: "demo", bed: "Bed 2", dischargedAt: new Date("2026-03-01") });
  await db.insert(guaranteeLetters).values({ id: "gl-1042-earlier", admissionId: "adm-1042-earlier", insurer: "Synthetic insurer", status: "requested", requestedAt: new Date("2026-02-27") });
  await decideReview(db, token, "approve", "", clock.now);
  const letters = Object.fromEntries((await db.select().from(guaranteeLetters)).map(g => [g.id, g.status]));
  expect([letters["gl-1042"], letters["gl-1042-earlier"]]).toEqual(["received", "requested"]);
});
