import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { guaranteeLetters } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import type { Context, Mail } from "./context";
import { decideReview, renderReviewPage, reviewPacket, reviewTokenOf } from "./insurer";
import { appRouter } from "./routers/index";

const session = {
  user: { id: "dr-aisyah", name: "Dr Aisyah", email: "aisyah@demo.test", emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: "s1", userId: "dr-aisyah", token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session;
const sent: Parameters<Mail["send"]>[0][] = [];
const mail = (fail = false): Mail => ({ from: "sona@mail.demo.test", insurer: "desk@insurer.test", send: async m => { if (fail) throw new Error("domain not onboarded"); sent.push(m); } });

/** Amelia's claim, documented and sent, as the app sends it. */
async function sentClaim(extra: Partial<Context> = {}) {
  sent.length = 0;
  const db = await createTestDb();
  await seedDemo(db);
  const clock = { now: new Date("2026-09-26T10:00:00+08:00") };
  const api = createRouterClient(appRouter, { context: { db, session, now: () => clock.now, publicUrl: "https://sona.test", ...extra } });
  await api.claim.update({ encounterId: "visit-1042", organismConfirmed: true, ivReasonAdded: true });
  await api.claim.send({ encounterId: "visit-1042", requestId: "c1", approvedBy: "dr-aisyah" });
  return { db, api, clock, token: await reviewTokenOf(db, "visit-1042") };
}

test("sending a claim creates a review link; the page shows the packet: patient, estimate, each code with its note sentence, and the criteria met", async () => {
  const { db, api, clock, token } = await sentClaim();
  expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
  const status = await api.claim.status({ encounterId: "visit-1042" });
  expect(status).toMatchObject({ status: "sent", reviewUrl: `https://sona.test/insurer/${token}` });
  const packet = (await reviewPacket(db, token, clock.now))!;
  expect(packet).toMatchObject({ patient: "Amelia Tan", insurer: "Synthetic insurer", estimate: "RM 3,480", status: "sent" });
  expect(packet.codes.find(c => c.code === "J18.9")).toMatchObject({ label: "Pneumonia, unspecified organism", evidence: "Community-acquired pneumonia, CURB-65 0." });
  expect(packet.criteria.every(c => c.status === "passed")).toBe(true);
  expect(await reviewPacket(db, "not-a-token", clock.now)).toBeUndefined();
});

test("the insurer approves: the claim is approved, the guarantee letter received, and a second decision changes nothing", async () => {
  const { db, api, clock, token } = await sentClaim();
  clock.now = new Date(clock.now.getTime() + 5 * 60_000);
  expect(await decideReview(db, token, "approve", "", clock.now)).toEqual({ ok: true, status: "approved" });
  expect(await api.claim.status({ encounterId: "visit-1042" })).toMatchObject({ status: "approved", approvedAt: clock.now.toISOString() });
  expect((await db.select().from(guaranteeLetters).where(eq(guaranteeLetters.id, "gl-1042")))[0]).toMatchObject({ status: "received" });
  expect(await decideReview(db, token, "query", "Why IV?", clock.now)).toEqual({ ok: false, reason: "Already decided: approved" });
});

test("the insurer queries: the claim shows their question, the letter stays outstanding, and an expired link cannot decide", async () => {
  const { db, api, clock, token } = await sentClaim();
  expect(await decideReview(db, token, "query", "  ", clock.now)).toEqual({ ok: false, reason: "Write the question for the doctor" });
  expect(await decideReview(db, token, "query", "Please attach the sputum culture request.", clock.now)).toEqual({ ok: true, status: "queried" });
  expect(await api.claim.status({ encounterId: "visit-1042" })).toMatchObject({ status: "queried", query: "Please attach the sputum culture request." });
  expect((await db.select().from(guaranteeLetters).where(eq(guaranteeLetters.id, "gl-1042")))[0]).toMatchObject({ status: "requested" });
  const other = await sentClaim();
  expect(await decideReview(other.db, other.token, "approve", "", new Date(other.clock.now.getTime() + 8 * 24 * 3600_000))).toEqual({ ok: false, reason: "This link has expired" });
});

test("the review link is emailed to the insurer's inbox; a failed email never fails the send, and with no mail configured nothing is sent", async () => {
  const { token } = await sentClaim({ mail: mail() });
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ from: "sona@mail.demo.test", to: "desk@insurer.test", subject: "Final guarantee letter · Amelia Tan · RM 3,480 (synthetic)" });
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
